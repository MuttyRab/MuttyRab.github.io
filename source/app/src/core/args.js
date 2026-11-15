'use strict';
// Turns a tool spec action + user-entered values into argv/env for spawning.
// This is the only place that knows the argv DSL; keep it small and tested.
//
// argv items:
//   "literal"                          -> pushed as-is
//   {"field": "id"}                    -> value (files/multiline lists expand to many args); skipped if empty
//   {"field": "id", "flag": "--x"}     -> checkbox: push flag when true
//                                         other:    push flag + value when non-empty
//   {"field": "id", "flag": "--x", "join": "="} -> push "--x=value"
//   {"when": "id", "equals": v, "argv": [...]}  -> nested items, only if field matches (truthy when no equals)

const LIST_TYPES = new Set(['files']);

function isEmpty(v) {
  return v === undefined || v === null || v === '' || v === false || (Array.isArray(v) && v.length === 0);
}

function fieldMap(action) {
  const m = new Map();
  for (const f of action.fields || []) m.set(f.id, f);
  return m;
}

function resolveValues(action, values) {
  const out = {};
  for (const f of action.fields || []) {
    let v = values[f.id];
    if (v === undefined) v = f.default;
    if (f.type === 'checkbox') v = v === true || v === 'true';
    if (f.type === 'number' && !isEmpty(v)) v = String(Number(v));
    if (LIST_TYPES.has(f.type) && typeof v === 'string') v = v ? [v] : [];
    out[f.id] = v;
  }
  return out;
}

function isVisible(field, vals) {
  if (!field.showIf) return true;
  const cur = vals[field.showIf.field];
  if ('equals' in field.showIf) return cur === field.showIf.equals;
  return !isEmpty(cur);
}

function validate(action, values) {
  const vals = resolveValues(action, values);
  const errors = [];
  for (const f of action.fields || []) {
    if (!isVisible(f, vals)) continue;
    const v = vals[f.id];
    if (f.required && isEmpty(v)) errors.push({ field: f.id, message: `${f.label} is required` });
    if (f.type === 'number' && !isEmpty(v) && Number.isNaN(Number(v))) errors.push({ field: f.id, message: `${f.label} must be a number` });
    if (f.type === 'select' && !isEmpty(v) && f.options && !f.options.some((o) => o.value === v)) {
      errors.push({ field: f.id, message: `${f.label} has an invalid choice` });
    }
    if (f.minLength && typeof v === 'string' && v.length > 0 && v.length < f.minLength) {
      errors.push({ field: f.id, message: `${f.label} must be at least ${f.minLength} characters` });
    }
  }
  return errors;
}

function expand(items, vals, fields, out) {
  for (const item of items) {
    if (typeof item === 'string') { out.push(item); continue; }
    if (item.when) {
      const cur = vals[item.when];
      const hit = 'equals' in item ? cur === item.equals : !isEmpty(cur);
      if (hit) expand(item.argv, vals, fields, out);
      continue;
    }
    const f = fields.get(item.field);
    if (!f) throw new Error(`argv references unknown field "${item.field}"`);
    if (!isVisible(f, vals)) continue;
    const v = vals[item.field];
    if (isEmpty(v)) continue;
    if (f.type === 'checkbox') { if (item.flag) out.push(item.flag); continue; }
    const list = Array.isArray(v) ? v : [String(v)];
    if (item.flag) {
      if (item.join) out.push(`${item.flag}${item.join}${list.join(',')}`);
      else { out.push(item.flag); out.push(list.join(',')); }
    } else {
      out.push(...list);
    }
  }
  return out;
}

function buildCommand(action, values) {
  const errors = validate(action, values);
  if (errors.length) { const e = new Error(errors.map((x) => x.message).join('; ')); e.fieldErrors = errors; throw e; }
  const vals = resolveValues(action, values);
  const fields = fieldMap(action);
  const argv = expand(action.argv || [], vals, fields, []);
  const env = {};
  for (const [k, spec] of Object.entries(action.env || {})) {
    if (typeof spec === 'string') { env[k] = spec; continue; }
    const v = vals[spec.field];
    if (!isEmpty(v)) env[k] = String(v);
  }
  // stdinField: the named field's text is piped to the tool's stdin (e.g. `typst compile -`),
  // so an AI assistant can hand over a whole document without writing a file first.
  const stdin = action.stdinField ? String(vals[action.stdinField] ?? '') : undefined;
  return { argv, env, stdin };
}

module.exports = { buildCommand, validate, resolveValues, isVisible };
