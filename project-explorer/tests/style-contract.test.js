'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('defines the approved semantic color tokens', () => {
  const requiredTokens = [
    '--color-background',
    '--color-surface',
    '--color-text',
    '--color-text-muted',
    '--color-accent',
    '--color-warning',
    '--color-danger',
    '--color-border',
    '--color-focus',
  ];

  for (const token of requiredTokens) {
    assert.match(css, new RegExp(`${token}\\s*:`));
  }

  assert.match(html, /status-positive[\s\S]*אומת מקומית/);
  assert.match(html, /status-warning[\s\S]*72 שגיאות/);
  assert.match(html, /status-blocked[^>]*>HOLD</);
});

test('pins visible focus and skip-link behavior', () => {
  assert.match(css, /:focus-visible\s*\{/);
  assert.match(css, /\.skip-link:focus(?:-visible)?\s*\{/);
  assert.match(css, /outline\s*:\s*[^;]+var\(--color-focus\)/);
});

test('supports reduced motion', () => {
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(css, /scroll-behavior\s*:\s*auto/);
  assert.match(css, /animation-duration\s*:\s*0\.01ms/);
  assert.match(css, /transition-duration\s*:\s*0\.01ms/);
});

test('defines tablet and mobile layouts', () => {
  assert.match(css, /@media\s*\(max-width:\s*960px\)/);
  assert.match(css, /@media\s*\(max-width:\s*640px\)/);
  assert.match(css, /@media\s*\(max-width:\s*640px\)[\s\S]*grid-template-columns\s*:\s*1fr/);
});

test('keeps technical flow readable on narrow screens', () => {
  assert.match(css, /body\s*\{[\s\S]*overflow-x\s*:\s*hidden/);
  assert.doesNotMatch(css, /body\s*\{[^}]*min-width/);
  assert.match(css, /\.technical-flow\s*\{[\s\S]*overflow-x\s*:\s*auto/);
  assert.match(html, /class="technical-flow"[^>]+aria-label=[^>]*>[\s\S]*class="product-flow"/);
  assert.doesNotMatch(html, /class="product-flow technical-flow"/);
});

test('keeps the closed mobile navigation inside the viewport', () => {
  assert.match(css, /@media\s*\(max-width:\s*960px\)[\s\S]*\.side-navigation\s*\{[\s\S]*visibility\s*:\s*hidden/);
  assert.match(css, /body\[data-nav-open="true"\]\s+\.side-navigation\s*\{[\s\S]*visibility\s*:\s*visible/);
  assert.doesNotMatch(css, /\.side-navigation\s*\{[\s\S]*transform\s*:\s*translateX\(115%\)/);
});

test('allows long technical identifiers to reflow at high zoom', () => {
  assert.match(css, /code\s*\{[^}]*overflow-wrap\s*:\s*anywhere/);
  assert.match(css, /\.start-grid\s+article\s*\{[^}]*min-width\s*:\s*0/);
});
