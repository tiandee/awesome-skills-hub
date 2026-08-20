'use strict';

module.exports = Object.assign(
  {},
  require('./archive'),
  require('./codex-guidance'),
  require('./config'),
  require('./create'),
  require('./discovery'),
  require('./doctor'),
  require('./library'),
  require('./repair'),
  require('./retention'),
  require('./snapshot'),
  require('./skills-sh'),
  require('./update'),
  require('./cli'),
  require('./util'),
  require('../ui/service'),
  require('../ui/server'),
  require('../ui/preferences'),
  require('../ui/status'),
);
