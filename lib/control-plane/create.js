'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { NAME_PATTERN } = require('./discovery');
const { isDirectory, lexists } = require('./util');

const MAX_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 1024;

function yamlString(value) {
  return JSON.stringify(String(value));
}

function displayName(name) {
  return name.split('-').map(function title(part) {
    return part.charAt(0).toUpperCase() + part.slice(1);
  }).join(' ');
}

function defaultDescription(name) {
  return 'Use when the user explicitly asks to use the ' + name + ' workflow.';
}

function skillMarkdown(name, description) {
  return [
    '---',
    'name: ' + name,
    'description: ' + yamlString(description),
    '---',
    '',
    '# ' + displayName(name),
    '',
    '<!-- Replace this scaffold with concise, imperative workflow instructions before completing the creation task. -->',
    '',
    '## Workflow',
    '',
    '1. Gather the inputs and constraints required for the workflow.',
    '2. Execute the domain-specific steps and use bundled resources only when needed.',
    '3. Verify the result against the user request before returning it.',
    '',
  ].join('\n');
}

function openaiYaml(name) {
  const title = displayName(name);
  const shortDescription = 'Create and use the ' + title + ' workflow';
  return [
    'interface:',
    '  display_name: ' + yamlString(title),
    '  short_description: ' + yamlString(shortDescription.slice(0, 64)),
    '  default_prompt: ' + yamlString('Use $' + name + ' to complete this workflow.'),
    '',
  ].join('\n');
}

function removeTemporaryTree(target) {
  if (!lexists(target)) return;
  fs.readdirSync(target).forEach(function removeEntry(name) {
    const entry = path.join(target, name);
    const stat = fs.lstatSync(entry);
    if (stat.isDirectory() && !stat.isSymbolicLink()) removeTemporaryTree(entry);
    else fs.unlinkSync(entry);
  });
  fs.rmdirSync(target);
}

function validateCreateInput(name, description) {
  if (typeof name !== 'string' || !NAME_PATTERN.test(name) || name.length > MAX_NAME_LENGTH) {
    throw new Error('Skill name must be 1-64 lowercase letters, digits, or hyphen-separated words');
  }
  if (!description || !String(description).trim()) throw new Error('Skill description must not be empty');
  if (/[<>]/.test(String(description))) throw new Error('Skill description must not contain angle brackets');
  if (String(description).length > MAX_DESCRIPTION_LENGTH) {
    throw new Error('Skill description must not exceed 1024 characters');
  }
}

function createSkill(settings, name, options) {
  const opts = options || {};
  const usedDefaultDescription = !opts.description;
  const description = String(opts.description || defaultDescription(name)).trim();
  validateCreateInput(name, description);
  if (lexists(settings.libraryRoot) && !isDirectory(settings.libraryRoot)) {
    throw new Error('universal Skill library is not a directory: ' + settings.libraryRoot);
  }
  fs.mkdirSync(settings.libraryRoot, { recursive: true });
  const destination = path.join(settings.libraryRoot, name);
  if (lexists(destination)) throw new Error('Skill already exists: ' + destination);

  const temporary = path.join(
    settings.libraryRoot,
    '.' + name + '.ash-create-' + process.pid + '-' + crypto.randomBytes(4).toString('hex'),
  );
  try {
    fs.mkdirSync(path.join(temporary, 'agents'), { recursive: true });
    fs.writeFileSync(path.join(temporary, 'SKILL.md'), skillMarkdown(name, description), { encoding: 'utf8', mode: 0o644 });
    fs.writeFileSync(path.join(temporary, 'agents', 'openai.yaml'), openaiYaml(name), { encoding: 'utf8', mode: 0o644 });
    if (lexists(destination)) throw new Error('Skill appeared while it was being created: ' + destination);
    fs.renameSync(temporary, destination);
  } finally {
    if (lexists(temporary)) removeTemporaryTree(temporary);
  }
  return {
    path: destination,
    files: [path.join(destination, 'SKILL.md'), path.join(destination, 'agents', 'openai.yaml')],
    usedDefaultDescription,
  };
}

module.exports = {
  MAX_DESCRIPTION_LENGTH,
  MAX_NAME_LENGTH,
  createSkill,
  defaultDescription,
  displayName,
  openaiYaml,
  skillMarkdown,
  validateCreateInput,
};
