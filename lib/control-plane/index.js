'use strict';

module.exports = Object.assign(
  {},
  require('./archive'),
  require('./catalog'),
  require('./config'),
  require('./discovery'),
  require('./doctor'),
  require('./repair'),
  require('./cli'),
  require('./util'),
);
