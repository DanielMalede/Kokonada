'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const core = require('../app-core.js');
const status = require('../status-data.js');

function fakeElement(attributes = {}) {
  const listeners = new Map();
  const attributeStore = new Map(Object.entries(attributes));
  const classes = new Set();

  return {
    dataset: {},
    textContent: '',
    listeners,
    focused: false,
    scrolled: false,
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name),
    },
    addEventListener: (name, handler) => listeners.set(name, handler),
    setAttribute: (name, value) => attributeStore.set(name, String(value)),
    getAttribute: (name) => attributeStore.get(name) || null,
    focus() {
      this.focused = true;
    },
    scrollIntoView() {
      this.scrolled = true;
    },
  };
}

function launchApp({ storedMode = 'off', currentCommit = '71b850c' } = {}) {
  const body = fakeElement();
  const toggle = fakeElement({ 'aria-pressed': 'true' });
  const label = fakeElement();
  const snapshot = fakeElement();
  const mobileToggle = fakeElement({ 'aria-expanded': 'false' });
  const nextLink = fakeElement({ href: '#journey' });
  const journey = fakeElement();
  const writes = [];

  const selectors = new Map([
    ['[data-learning-toggle]', toggle],
    ['[data-learning-label]', label],
    ['[data-snapshot-state]', snapshot],
    ['[data-mobile-nav-toggle]', mobileToggle],
    ['#journey', journey],
  ]);

  const document = {
    readyState: 'complete',
    body,
    querySelector: (selector) => selectors.get(selector) || null,
    querySelectorAll: (selector) => {
      if (selector === '[data-next-step]') return [nextLink];
      if (selector === '#project-navigation a') return [];
      return [];
    },
  };

  const window = {
    document,
    KokonadaExplorerCore: core,
    KokonadaStatus: status,
    __KOKONADA_CURRENT_COMMIT__: currentCommit,
    localStorage: {
      getItem: () => storedMode,
      setItem: (key, value) => writes.push([key, value]),
    },
    matchMedia: () => ({ matches: false }),
  };
  window.window = window;

  const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  vm.runInNewContext(source, window, { filename: 'app.js' });

  return { body, toggle, label, snapshot, nextLink, journey, writes };
}

test('applies stored Learning Mode and persists toggle changes', () => {
  const app = launchApp({ storedMode: 'off' });

  assert.equal(app.body.dataset.learningMode, 'off');
  assert.equal(app.toggle.getAttribute('aria-pressed'), 'false');
  assert.equal(app.label.textContent, 'מצב למידה כבוי');

  app.toggle.listeners.get('click')();

  assert.equal(app.body.dataset.learningMode, 'on');
  assert.deepEqual(app.writes, [['kokonada.learningMode', 'on']]);
});

test('renders stale snapshot state with text and status class', () => {
  const app = launchApp({ currentCommit: '71b850c' });

  assert.equal(app.body.dataset.enhanced, 'true');
  assert.equal(app.snapshot.dataset.snapshotState, 'stale');
  assert.equal(app.snapshot.classList.contains('status-stale'), true);
  assert.match(app.snapshot.textContent, /snapshot אינו תואם/);
});

test('moves focus and scroll to the selected next section', () => {
  const app = launchApp();
  let prevented = false;

  app.nextLink.listeners.get('click')({ preventDefault: () => { prevented = true; } });

  assert.equal(prevented, true);
  assert.equal(app.journey.focused, true);
  assert.equal(app.journey.scrolled, true);
});
