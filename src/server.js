/**
 * Created by tdzl2003 on 1/12/16.
 */
import Koa from 'koa';
import bodyParser from 'koa-bodyparser';
import Router from 'koa-router';

import Docker from 'dockerode';
import * as fs from 'fs';

const docker = new Docker();

// compute info
const dockerConfig = {
  'DOCKER_HOST': process.env.DOCKER_HOST,
};
const extraCreateConfig = {};
const extraRunConfig = {};
if (process.env.DOCKER_TLS_VERIFY && process.env.DOCKER_TLS_VERIFY > 0){
  dockerConfig.DOCKER_TLS_VERIFY = 1;
  dockerConfig.DOCKER_CERT_PATH = '/cert';
  extraCreateConfig.Volumes = {};
  extraCreateConfig.Volumes['/cert'] = {};
  extraRunConfig.Binds = [process.env.DOCKER_CERT_PATH + ':/cert'];
}


const buildConfig = {
  "test": {
    "env": {
      'TAG': 'reactnativecn',
      'VERSION': 'test',
      'REPO': 'https://github.com/reactnativecn/react-native.cn.git',
      'BRANCH': 'master',
    }
  }
};

let building = false;
const pendingBuild = [];
const pendingBuildMap = {};

function translateEnv(obj){
  return Object.keys(obj).map(k=>k+'='+obj[k]);
}

async function startBuild(name) {
  if (building){
    if (!pendingBuildMap[name]){
      pendingBuild.push(name);
      pendingBuildMap[name] = true;
    }
    return;
  }
  building = true;

  // Invoke build process.
  await new Promise(resolve=> {
    docker.run('build', undefined, process.stdout, {
      Env: translateEnv({...buildConfig[name].env, ...dockerConfig}),
      ...extraCreateConfig
    }, extraRunConfig, function (err, data, container) {
      if (err){
        console.error(err);
      }
      container && container.remove(()=> {
      });
      resolve();
    });
  });

  // Restart all containers.

  building = false;
  if (pendingBuild.length){
    const next = pendingBuild.shift();
    delete pendingBuildMap[next];
    startBuild(next);
  }
}

startBuild('test');

//const app = new Koa();
//
//app.use((ctx, next) => {
//  return next()
//    .catch(err => {
//      ctx.body = {
//        message: err.message,
//      };
//      ctx.status = err.status;
//    });
//});
//
//app.use(bodyParser());
//
//const router = new Router();
//
//router.post('/reactnativecn', async function(){
//  docker.run('build', undefined, process.stdout, function(err, data, container){
//    container.remove();
//  })
//});
//
//router.post('/reactnativedocscn', async function(){
//
//})
//
//app.use(router.routes());
//
//// Start port listening
//app.listen(3099);
