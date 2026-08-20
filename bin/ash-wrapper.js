#!/usr/bin/env node
'use strict';

const path = require('path');
const { main } = require('../lib/control-plane/cli');

process.exitCode = main(process.argv.slice(2), {
  projectRoot: process.env.ASH_PROJECT_ROOT || path.resolve(__dirname, '..'),
});
