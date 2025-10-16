const USLM_NS = "http://xml.house.gov/schemas/uslm/1.0";
const STRUCTURAL_TAGS = new Set([
  "division",
  "subtitle",
  "title",
  "part",
  "subpart",
  "chapter",
  "subchapter",
  "article",
  "section",
  "appendix",
  "compiledAct",
  "subpart1",
]);

const state = {
  titles: [],
  xmlCache: new Map(),
  navigation: new Map(),
  selectedTitleId: null,
  selectedSectionId: null,
};

const elements = {
  titleList: document.getElementById("title-list"),
  titleFilter: document.getElementById("title-filter"),
  documentViewer: document.getElementById("document-viewer"),
  message: document.getElementById("document-message"),
  breadcrumbs: document.getElementById("breadcrumbs"),
  titleOverview: document.getElementById("title-overview"),
  toc: document.getElementById("toc"),
  sectionContent: document.getElementById("section-content"),
  citationForm: document.getElementById("citation-search"),
  citationTitle: document.getElementById("citation-title"),
  citationSection: document.getElementById("citation-section"),
};

async function bootstrap() {
  const response = await fetch("data/titles.json");
  if (!response.ok) {
    elements.message.textContent = "Unable to load US Code metadata.";
    return;
  }
  const data = await response.json();
  state.titles = data.titles;
  renderTitleList(state.titles);
  elements.titleFilter.addEventListener("input", handleTitleFilter);
  elements.citationForm.addEventListener("submit", handleCitationSearch);
  elements.message.textContent = "Select a title to begin browsing the code.";
}

function renderTitleList(titles) {
  elements.titleList.innerHTML = "";
  titles.forEach((title) => {
    const item = document.createElement("div");
    item.className = "title-item";
    item.dataset.titleId = title.file;

    const button = document.createElement("button");
    button.type = "button";
    button.addEventListener("click", () => loadTitle(title.file));

    const label = document.createElement("span");
    label.className = "title-item__label";
    label.textContent = title.label || `Title ${title.number}`;

    const heading = document.createElement("span");
    heading.className = "title-item__heading";
    heading.textContent = title.heading || title.label;

    button.append(label, heading);
    item.appendChild(button);
    elements.titleList.appendChild(item);
  });
}

function handleTitleFilter(event) {
  const query = event.target.value.trim().toLowerCase();
  Array.from(elements.titleList.children).forEach((item) => {
    const text = item.textContent.toLowerCase();
    item.hidden = query ? !text.includes(query) : false;
  });
}

async function loadTitle(file) {
  const metadata = state.titles.find((title) => title.file === file);
  if (!metadata) return;
  state.selectedTitleId = file;
  state.selectedSectionId = null;

  elements.sectionContent.hidden = true;
  elements.toc.hidden = true;
  elements.titleOverview.hidden = true;
  elements.breadcrumbs.innerHTML = "";
  elements.message.textContent = "Loading title...";

  highlightTitle(file);

  if (metadata.pointer) {
    elements.message.textContent =
      "This title uses Git LFS storage. Fetch the source XML locally to view its content.";
    return;
  }

  try {
    const { doc } = await fetchTitleDocument(metadata);
    const nav = buildNavigation(metadata, doc);
    state.navigation.set(file, nav);
    renderTitle(metadata, nav);
  } catch (error) {
    console.error(error);
    elements.message.textContent = "Unable to parse the selected title.";
  }
}

function highlightTitle(file) {
  Array.from(elements.titleList.children).forEach((item) => {
    item.classList.toggle("active", item.dataset.titleId === file);
  });
}

async function fetchTitleDocument(metadata) {
  if (state.xmlCache.has(metadata.file)) {
    return state.xmlCache.get(metadata.file);
  }
  const response = await fetch(metadata.file);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${metadata.file}`);
  }
  const text = await response.text();
  if (text.startsWith("version https://git-lfs.github.com")) {
    throw new Error("XML content not available. Git LFS placeholder detected.");
  }
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) {
    throw new Error("Unable to parse XML document");
  }
  const payload = { doc, text };
  state.xmlCache.set(metadata.file, payload);
  return payload;
}

function buildNavigation(metadata, doc) {
  const main = doc.getElementsByTagNameNS(USLM_NS, "main")[0];
  const rootElement = main
    ? Array.from(main.children).find((child) => STRUCTURAL_TAGS.has(child.localName))
    : doc.documentElement;
  if (!rootElement) {
    throw new Error("Unable to locate structural root in XML document");
  }

  const rootNode = parseStructure(rootElement);
  const index = new Map();
  buildIndex(rootNode, [], index);

  return { metadata, root: rootNode, index };
}

function parseStructure(element) {
  const type = element.localName;
  if (!STRUCTURAL_TAGS.has(type)) {
    return null;
  }
  const node = {
    type,
    identifier: element.getAttribute("identifier") || "",
    number: directChildText(element, "num"),
    heading: directChildText(element, "heading"),
    children: [],
  };

  const children = Array.from(element.children)
    .map((child) => parseStructure(child))
    .filter(Boolean);
  node.children = children;
  return node;
}

function buildIndex(node, parents, index) {
  const path = [...parents, node];
  if (node.identifier) {
    index.set(node.identifier, path);
  }
  if (node.type === "section" && node.number) {
    index.set(sectionKey(node.number), path);
  }
  node.children.forEach((child) => buildIndex(child, path, index));
}

function sectionKey(value) {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function directChildText(element, name) {
  const child = Array.from(element.children).find(
    (el) => el.namespaceURI === USLM_NS && el.localName === name,
  );
  return child ? child.textContent.trim() : "";
}

function renderTitle(metadata, nav) {
  elements.message.textContent = "";
  elements.titleOverview.hidden = false;
  elements.titleOverview.innerHTML = `
    <h2>${metadata.heading}</h2>
    <p><strong>Citation:</strong> Title ${metadata.number}</p>
    <p class="overview-meta">Source file: <code>${metadata.file}</code></p>
  `;

  elements.toc.hidden = false;
  elements.toc.innerHTML = "";
  elements.toc.appendChild(renderTree(nav.root));
}

function renderTree(node) {
  if (!node) return document.createTextNode("");

  if (node.type === "section") {
    const button = document.createElement("button");
    button.className = "section-link";
    button.type = "button";
    button.textContent = formatNodeLabel(node);
    if (node.identifier) {
      button.dataset.identifier = node.identifier;
    }
    if (node.number) {
      button.dataset.number = node.number;
    }
    button.addEventListener("click", () => displaySection(node.identifier || node.number));
    return button;
  }

  const details = document.createElement("details");
  if (node.type === "title" || node.type === "appendix") {
    details.open = true;
  }
  const summary = document.createElement("summary");
  summary.textContent = formatNodeLabel(node);
  details.appendChild(summary);

  if (node.children.length) {
    const wrapper = document.createElement("div");
    wrapper.className = "toc-children";
    node.children.forEach((child) => {
      const childElement = renderTree(child);
      if (childElement) {
        wrapper.appendChild(childElement);
      }
    });
    details.appendChild(wrapper);
  }
  return details;
}

function formatNodeLabel(node) {
  const num = node.number ? node.number.replace(/—+$/, "").trim() : "";
  const heading = node.heading ? node.heading.trim() : "";
  if (num && heading) {
    return `${num} ${heading}`;
  }
  return heading || num || node.type.toUpperCase();
}

async function displaySection(identifierOrNumber) {
  const titleId = state.selectedTitleId;
  if (!titleId) return;
  const nav = state.navigation.get(titleId);
  if (!nav) return;

  const lookupKey = identifierOrNumber.startsWith("/us/")
    ? identifierOrNumber
    : sectionKey(identifierOrNumber);
  const path = nav.index.get(lookupKey);
  if (!path) {
    elements.message.textContent = "Section could not be located in this title.";
    return;
  }
  const sectionNode = path[path.length - 1];
  state.selectedSectionId = sectionNode.identifier || sectionNode.number;

  try {
    const { doc } = await fetchTitleDocument(nav.metadata);
    const sectionElement = findSectionElement(doc, sectionNode.identifier, sectionNode.number);
    if (!sectionElement) {
      elements.message.textContent = "Section markup not found in XML.";
      return;
    }
    renderBreadcrumbs(path);
    renderSection(sectionElement);
    highlightSectionLink(sectionNode);
  } catch (error) {
    console.error(error);
    elements.message.textContent = "Unable to render section.";
  }
}

function renderBreadcrumbs(path) {
  elements.breadcrumbs.innerHTML = "";
  path.forEach((node) => {
    if (!node.heading && !node.number) return;
    const span = document.createElement("span");
    span.textContent = formatNodeLabel(node);
    elements.breadcrumbs.appendChild(span);
  });
}

function findSectionElement(doc, identifier, number) {
  const sections = doc.getElementsByTagNameNS(USLM_NS, "section");
  const sectionList = Array.from(sections);
  if (identifier) {
    const match = sectionList.find((section) => section.getAttribute("identifier") === identifier);
    if (match) return match;
  }
  if (!number) return null;
  const targetKey = sectionKey(number);
  return sectionList.find((section) => sectionKey(directChildText(section, "num")) === targetKey) || null;
}

function renderSection(sectionElement) {
  elements.sectionContent.hidden = false;
  elements.sectionContent.innerHTML = "";

  const header = document.createElement("header");
  header.className = "section-header";

  const headingGroup = document.createElement("div");
  headingGroup.className = "section-heading-group";
  const number = directChildText(sectionElement, "num");
  const heading = directChildText(sectionElement, "heading");
  if (number) {
    const span = document.createElement("span");
    span.className = "section-number";
    span.textContent = number.replace(/—+$/, "").trim();
    headingGroup.appendChild(span);
  }
  if (heading) {
    const h2 = document.createElement("span");
    h2.className = "section-heading";
    h2.textContent = heading;
    headingGroup.appendChild(h2);
  }
  header.appendChild(headingGroup);

  const toggle = document.createElement("div");
  toggle.className = "section-toggle";
  const textButton = document.createElement("button");
  textButton.type = "button";
  textButton.className = "section-toggle__button is-active";
  textButton.textContent = "Statute";
  textButton.setAttribute("aria-pressed", "true");
  const notesButton = document.createElement("button");
  notesButton.type = "button";
  notesButton.className = "section-toggle__button";
  notesButton.textContent = "Notes";
  notesButton.setAttribute("aria-pressed", "false");
  toggle.append(textButton, notesButton);
  header.appendChild(toggle);

  elements.sectionContent.appendChild(header);

  const panels = document.createElement("div");
  panels.className = "section-panels";
  panels.dataset.view = "statute";

  const statutePanel = document.createElement("div");
  statutePanel.className = "section-panel section-panel--statute";
  statutePanel.id = "section-statute";
  textButton.setAttribute("aria-controls", statutePanel.id);

  const content = directChild(sectionElement, "content");
  if (content) {
    const body = document.createElement("div");
    body.className = "usc-body";
    content.childNodes.forEach((child) => {
      const rendered = renderNode(child);
      if (rendered) body.appendChild(rendered);
    });
    statutePanel.appendChild(body);
  } else {
    const empty = document.createElement("p");
    empty.className = "section-empty";
    empty.textContent = "No statutory text is available for this section.";
    statutePanel.appendChild(empty);
  }

  panels.appendChild(statutePanel);

  const notesList = Array.from(sectionElement.children).filter(
    (child) => child.namespaceURI === USLM_NS && child.localName === "notes",
  );
  const notesPanel = document.createElement("div");
  notesPanel.className = "section-panel section-panel--notes";
  notesPanel.id = "section-notes";
  notesButton.setAttribute("aria-controls", notesPanel.id);
  if (notesList.length) {
    notesList.forEach((notes) => {
      const noteElement = renderNotes(notes);
      if (noteElement) {
        notesPanel.appendChild(noteElement);
      }
    });
  } else {
    const emptyNotes = document.createElement("p");
    emptyNotes.className = "section-empty";
    emptyNotes.textContent = "There are no editorial notes for this section.";
    notesPanel.appendChild(emptyNotes);
  }

  panels.appendChild(notesPanel);
  elements.sectionContent.appendChild(panels);

  const switchView = (view) => {
    panels.dataset.view = view;
    const showNotes = view === "notes";
    notesButton.classList.toggle("is-active", showNotes);
    textButton.classList.toggle("is-active", !showNotes);
    notesButton.setAttribute("aria-pressed", showNotes ? "true" : "false");
    textButton.setAttribute("aria-pressed", showNotes ? "false" : "true");
  };

  textButton.addEventListener("click", () => switchView("statute"));
  notesButton.addEventListener("click", () => switchView("notes"));

  scrollSectionIntoView();
}

function directChild(element, name) {
  return Array.from(element.children).find(
    (el) => el.namespaceURI === USLM_NS && el.localName === name,
  );
}

function highlightSectionLink(targetNode) {
  const targetIdentifier = targetNode.identifier || "";
  const targetNumberKey = targetNode.number ? sectionKey(targetNode.number) : "";
  const buttons = document.querySelectorAll(".section-link");
  buttons.forEach((button) => {
    const identifier = button.dataset.identifier || "";
    const numberKey = button.dataset.number ? sectionKey(button.dataset.number) : "";
    const isMatch =
      (targetIdentifier && identifier === targetIdentifier) ||
      (!targetIdentifier && targetNumberKey && numberKey === targetNumberKey);
    button.classList.toggle("active", Boolean(isMatch));
  });
}

function scrollSectionIntoView() {
  const rect = elements.sectionContent.getBoundingClientRect();
  const offset = window.scrollY + rect.top - 80;
  window.scrollTo({ top: Math.max(offset, 0), behavior: "smooth" });
}

function renderNode(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent.trim();
    return text ? document.createTextNode(text + " ") : null;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return null;
  }

  switch (node.localName) {
    case "p":
      return renderParagraph(node);
    case "paragraph":
    case "subparagraph":
    case "subsection":
    case "clause":
    case "subclause":
    case "item":
    case "subitem":
      return renderStructuredBlock(node);
    case "note":
      return renderNote(node);
    case "quotedContent":
      return renderQuoted(node);
    case "list":
      return renderList(node);
    default:
      const fragment = document.createElement("div");
      fragment.className = `usc-${node.localName}`;
      node.childNodes.forEach((child) => {
        const rendered = renderNode(child);
        if (rendered) fragment.appendChild(rendered);
      });
      return fragment.childNodes.length ? fragment : null;
  }
}

function renderParagraph(node) {
  const p = document.createElement("p");
  node.childNodes.forEach((child) => {
    const rendered = renderInline(child);
    if (rendered) p.appendChild(rendered);
  });
  return p;
}

function renderInline(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    return document.createTextNode(node.textContent);
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return null;
  }
  switch (node.localName) {
    case "ref": {
      const a = document.createElement("a");
      a.href = node.getAttribute("href") || "#";
      a.textContent = node.textContent.trim();
      a.target = "_blank";
      a.rel = "noreferrer";
      return a;
    }
    case "emphasis": {
      const em = document.createElement("em");
      node.childNodes.forEach((child) => {
        const rendered = renderInline(child);
        if (rendered) em.appendChild(rendered);
      });
      return em;
    }
    case "term": {
      const span = document.createElement("span");
      span.className = "usc-term";
      span.textContent = node.textContent.trim();
      return span;
    }
    case "quotedContent":
      return renderQuoted(node);
    default: {
      const span = document.createElement("span");
      node.childNodes.forEach((child) => {
        const rendered = renderInline(child);
        if (rendered) span.appendChild(rendered);
      });
      return span;
    }
  }
}

function renderStructuredBlock(node) {
  const wrapper = document.createElement("div");
  wrapper.className = `usc-${node.localName}`;
  const markerText = directChildText(node, "num");
  if (markerText) {
    const marker = document.createElement("span");
    marker.className = "usc-marker";
    marker.textContent = markerText;
    wrapper.appendChild(marker);
  }
  const headingText = directChildText(node, "heading");
  if (headingText) {
    const heading = document.createElement("strong");
    heading.textContent = headingText + " ";
    wrapper.appendChild(heading);
  }
  const body = document.createElement("div");
  body.className = "usc-text";
  node.childNodes.forEach((child) => {
    if (child.namespaceURI === USLM_NS && ["num", "heading"].includes(child.localName)) {
      return;
    }
    const rendered = renderNode(child);
    if (rendered) body.appendChild(rendered);
  });
  wrapper.appendChild(body);
  return wrapper;
}

function renderNote(node) {
  const container = document.createElement("section");
  container.className = "usc-note";
  const heading = directChildText(node, "heading");
  if (heading) {
    const h3 = document.createElement("h3");
    h3.textContent = heading;
    container.appendChild(h3);
  }
  node.childNodes.forEach((child) => {
    if (child.namespaceURI === USLM_NS && child.localName === "heading") {
      return;
    }
    const rendered = renderNode(child);
    if (rendered) container.appendChild(rendered);
  });
  return container;
}

function renderNotes(notes) {
  const fragment = document.createElement("section");
  fragment.className = "usc-note";
  const heading = notes.getAttribute("role") || "Notes";
  const h3 = document.createElement("h3");
  h3.textContent = heading.replace(/([A-Z])/g, " $1").trim();
  fragment.appendChild(h3);
  notes.childNodes.forEach((child) => {
    const rendered = renderNode(child);
    if (rendered) fragment.appendChild(rendered);
  });
  return fragment;
}

function renderQuoted(node) {
  const block = document.createElement("blockquote");
  block.className = "usc-quoted";
  node.childNodes.forEach((child) => {
    const rendered = renderNode(child);
    if (rendered) block.appendChild(rendered);
  });
  return block;
}

function renderList(node) {
  const ul = document.createElement("ul");
  node.childNodes.forEach((child) => {
    if (child.nodeType !== Node.ELEMENT_NODE || child.localName !== "item") return;
    const li = document.createElement("li");
    const rendered = renderNode(child);
    if (rendered) li.appendChild(rendered);
    ul.appendChild(li);
  });
  return ul;
}

async function handleCitationSearch(event) {
  event.preventDefault();
  const titleValue = elements.citationTitle.value.trim();
  const sectionValue = elements.citationSection.value.trim();
  if (!titleValue) {
    elements.message.textContent = "Enter a title number to search.";
    return;
  }
  const titleMeta = state.titles.find((t) => normalizeTitleNumber(t.number) === normalizeTitleNumber(titleValue));
  if (!titleMeta) {
    elements.message.textContent = `Title ${titleValue} not found.`;
    return;
  }
  await loadTitle(titleMeta.file);
  if (sectionValue) {
    displaySection(sectionValue);
  }
}

function normalizeTitleNumber(value) {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

document.addEventListener("DOMContentLoaded", bootstrap);
