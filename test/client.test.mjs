/**
 * Client bundle smoke test: load the ModuleLoader bundle with a stub window,
 * a stub React and a stub ctx, then render the main page once.
 *
 * It cannot prove the page looks right — only that the bundle loads, exports
 * apply/inject, registers every slot it promises and renders without throwing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(root, 'client.js'), 'utf8');

function loadBundle() {
  let captured = null;
  const window = {
    __ModuleLoader__: {
      load(definition) {
        captured = definition;
      }
    }
  };
  const bodyClasses = new Set();
  const document = {
    createElement() {
      return { setAttribute() {}, textContent: '', remove() {} };
    },
    head: { appendChild() {} },
    body: { classList: {
      toggle(name, enabled) { if (enabled) bodyClasses.add(name); else bodyClasses.delete(name); },
      remove(name) { bodyClasses.delete(name); },
      contains(name) { return bodyClasses.has(name); }
    } }
  };
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', source)(window, document);
  assert.ok(captured, 'bundle called window.__ModuleLoader__.load');
  const react = {
    Fragment: 'fragment',
    createElement(type, props, ...children) {
      return { type, props: props || {}, children };
    },
    useState(initial) {
      return [typeof initial === 'function' ? initial() : initial, () => {}];
    },
    useEffect() {},
    useRef(initial) { return { current: initial }; }
  };
  const exports = captured.factory((name) => {
    assert.ok(name === 'react', `unexpected require(${name})`);
    return react;
  });
  return { definition: captured, exports, react, document };
}

function makeCtx() {
  const registrations = [];
  const sessions = {
    list: {
      getSnapshot: () => ({ byId: {} }),
      subscribe: () => () => {}
    }
  };
  const ctx = {
    locale: {
      bind: () => (key) => key,
      register: () => () => {},
      subscribe: () => () => {}
    },
    get(name) {
      if (name === 'sessions') return sessions;
      return undefined;
    },
    slots: {
      inject(_name, fn) {
        fn();
      },
      register(definition, component) {
        registrations.push({ definition, component });
        return () => {};
      }
    },
    effect(fn) {
      fn();
      return () => {};
    }
  };
  return { ctx, registrations };
}

test('bundle id matches the package name', () => {
  const { definition } = loadBundle();
  assert.equal(definition.id, 'dsh-manage-deletion');
});

test('bundle exports apply and injects the sidebar/layout services', () => {
  const { exports } = loadBundle();
  assert.equal(typeof exports.apply, 'function');
  assert.deepEqual(exports.inject, ['slots', 'locale', 'sessions', 'layout']);
});

test('apply registers the sidebar row, main page, row hooks and dialog', () => {
  const { exports } = loadBundle();
  const { ctx, registrations } = makeCtx();
  exports.apply(ctx);

  const byName = (name) => registrations.filter((entry) => entry.definition.name === name);
  assert.equal(byName('sidebar.panellist').length, 1, '删除管理 sidebar row');
  assert.equal(byName('sidebar.panellist')[0].definition.id, 'manage-deletion');
  assert.equal(byName('sidebar.panellist')[0].definition.label, 'label');

  assert.equal(byName('main').length, 1, 'main page');
  assert.equal(byName('main')[0].definition.key, 'manage-deletion');

  assert.equal(byName('sidebar.workspaces').length, 0, 'never takes the workspace list seat');
  assert.equal(byName('sidebar.session.row.leading').length, 0, 'status-dependent leading slot is not used for selection');
  assert.equal(byName('sidebar.workspaces.session.row.action').length, 1, 'row selection/delete actions');
  assert.equal(byName('sidebar.workspaces.session.menu.item').length, 1, 'context-menu delete');
  assert.equal(byName('shell.overlay').length, 3, 'confirm dialog + select bar + toast');
});

test('the main page renders one panel without throwing', () => {
  const { exports } = loadBundle();
  const { ctx, registrations } = makeCtx();
  exports.apply(ctx);
  const main = registrations.find((entry) => entry.definition.name === 'main');
  const element = main.component({});
  assert.equal(typeof element.type, 'function');

  const tree = element.type(element.props);
  assert.equal(tree.type, 'div');
  assert.equal(tree.props.className, '__md_page');
});

test('the dialog host renders nothing until a delete is requested', () => {
  const { exports } = loadBundle();
  const { ctx, registrations } = makeCtx();
  exports.apply(ctx);
  const overlay = registrations.find((entry) => entry.definition.name === 'shell.overlay');
  const element = overlay.component({});
  const tree = element.type(element.props);
  assert.equal(tree, null);
});

test('row checkbox keeps hook order and appears after entering multi-select', () => {
  const { exports, react, document } = loadBundle();
  const { ctx, registrations } = makeCtx();
  exports.apply(ctx);

  const states = [];
  let cursor = 0;
  let expectedHooks = null;
  const subscriptions = [];
  react.useState = (initial) => {
    const index = cursor++;
    if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
    return [states[index], (value) => {
      states[index] = typeof value === 'function' ? value(states[index]) : value;
    }];
  };
  react.useRef = (initial) => {
    const index = cursor++;
    if (!(index in states)) states[index] = { current: initial };
    return states[index];
  };
  react.useEffect = (effect) => { cursor++; subscriptions.push(effect); };
  function render(component, props) {
    cursor = 0;
    subscriptions.length = 0;
    const result = component(props);
    if (expectedHooks !== null) assert.equal(cursor, expectedHooks, 'React hook count must not change across select-mode transition');
    expectedHooks = cursor;
    subscriptions.forEach((effect) => effect());
    return result;
  }

  const action = registrations.find((entry) => entry.definition.name === 'sidebar.workspaces.session.row.action');
  const row = action.component({ sessionId: 'session-x' });
  const idle = render(row.type, row.props);
  assert.equal(idle.type, 'fragment', 'hover actions are shown before select mode');
  idle.children[0].props.onClick({ preventDefault() {}, stopPropagation() {} });
  assert.equal(document.body.classList.contains('__md_selecting'), true, 'multi-select forces the checkbox visible on host session rows');
  const checkbox = render(row.type, row.props);
  assert.equal(checkbox.type, 'input');
  assert.equal(checkbox.props.type, 'checkbox');
  assert.equal(checkbox.props['aria-label'], 'session-x');
  assert.match(checkbox.props.className, /__md_rowSelect/);
});

test('selection CSS overrides host hover-only quick actions and anchors checkbox on the left', () => {
  assert.match(source, /body\.__md_selecting \[class\*="sessionRow"\] \[class\*="rowActions"\]\{display:inline-flex!important\}/);
  assert.match(source, /\[data-slot\]:has\(\.__md_rowSelect\)\{display:contents!important\}/);
  assert.match(source, /\.__md_rowSelect\{position:absolute;left:8px;top:50%/);
});

test('the row delete button renders a button with an accessible label', () => {
  const { exports } = loadBundle();
  const { ctx, registrations } = makeCtx();
  exports.apply(ctx);
  const action = registrations.find((entry) => entry.definition.name === 'sidebar.workspaces.session.row.action');
  const wrapper = action.component({ sessionId: 'session-x' });
  const inner = wrapper.type(wrapper.props);
  assert.equal(inner.type, 'fragment');
  const buttons = inner.children.filter((child) => child && child.type === 'button');
  assert.equal(buttons.length, 2, 'select toggle + delete');
  assert.equal(buttons[1].props['aria-label'], 'deleteOne');
});
