#!/usr/bin/env node
/**
 * Created by tdzl2_000 on 2015-12-18.
 */
var fs = require('fs');
var path = require('path');

require('babel-register')({
  ignore: filename => {
    var dir = path.dirname(filename);
    for (;dir !== path.dirname(dir); dir = path.dirname(dir)) {
      if (path.basename(dir) === 'node_modules') {
        break;
      }
      if (fs.existsSync(path.join(dir, '.babelrc'))) {
        return false;
      }
    }
    return true;
  },
});

require('../src/server');
