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

function asyncFn(func){
  return new Promise((resolve, reject)=>{
    func((err, data)=>{
      err ? reject(err) : resolve(data);
    })
  })
}

async function restartService(name, createConfigure, startConfigure){
  console.log('Stopping: ' + name);
  const container = docker.getContainer(name);
  if (container) {
    await new Promise(cb=>container.kill(cb));
    await new Promise(cb=>container.remove(cb));
  }

  console.log('Starting: ' + name);
  const newcontainer = await asyncFn(cb=>docker.createContainer({
    name: name,
    ...createConfigure
  }, cb));

  await asyncFn(cb=>newcontainer.start(startConfigure, cb));
  console.log("Start completed.");
}

const buildConfig = {
  "test": {
    "env": {
      'TAG': 'reactnativecn',
      'VERSION': 'test',
      'REPO': 'https://github.com/reactnativecn/react-native.cn.git',
      'BRANCH': 'master',
    },
    "postBuild": async ()=>{
      await restartService('reactnativecn-test', {
        Image: 'reactnativecn:test',
        ExposedPorts: {
          '3000/tcp' : {}
        },
      }, {
        PortBindings: {
          '3000/tcp' : [{
            HostPort: '3001'
          }]
        },
      });
    }
  },
  "router": {
    "env": {
      'TAG': 'router',
      'VERSION': 'test',
      'REPO': 'https://github.com/reactnativecn/react-native.cn.git',
      'BRANCH': 'router',
    },
    "postBuild": async ()=>{
      await restartService('router', {
        Image: 'router',
        ExposedPorts: {
          '80/tcp' : {}
        },
      }, {
        PortBindings: {
          '80/tcp' : [{
            HostPort: '80'
          }]
        },
      });
    }
  },
  "main": {
    "env": {
      'TAG': 'reactnativecn',
      'VERSION': 'latest',
      'REPO': 'https://github.com/reactnativecn/react-native.cn.git',
      'BRANCH': 'stable',
    },
    "postBuild": async ()=>{
      await restartService('reactnativecn-1', {
        Image: 'reactnativecn',
        ExposedPorts: {
          '3000/tcp' : {}
        },
      }, {
        PortBindings: {
          '3000/tcp' : [{
            HostPort: '3002'
          }],
        },
      });
      await restartService('reactnativecn-2', {
        Image: 'reactnativecn',
        ExposedPorts: {
          '3000/tcp' : {}
        },
      }, {
        PortBindings: {
          '3000/tcp' : [{
            HostPort: '3003'
          }]
        },
      });
    }
  },
  "docs": {
    "env": {
      'TAG': 'reactnativedocscn',
      'VERSION': 'latest',
      'REPO': 'https://github.com/reactnativecn/react-native-docs-cn.git',
      'BRANCH': 'master',
    },
    "postBuild": async ()=>{
      await restartService('reactnativedocscn-1', {
        Image: 'reactnativedocscn',
        ExposedPorts: {
          '80/tcp' : {}
        },
      }, {
        PortBindings: {
          '80/tcp' : [{
            HostPort: '8001'
          }],
        },
      });
      await restartService('reactnativedocscn-2', {
        Image: 'reactnativedocscn',
        ExposedPorts: {
          '80/tcp' : {}
        },
      }, {
        PortBindings: {
          '80/tcp' : [{
            HostPort: '8002'
          }]
        },
      });
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

  let container;
  try{
    // Create build container
    container = await asyncFn(cb=>docker.createContainer({
      name: 'build-' + name + '-' + Date.now(),
      Image: 'build',
      Env: translateEnv({...buildConfig[name].env, ...dockerConfig}),
      ...extraCreateConfig
    }, cb));

    const stream = await asyncFn(cb=>container.attach({
      stream:true,
      stdout:true,
      stderr:true
    }, cb));

    stream.setEncoding('utf8');
    stream.pipe(process.stdout, {
      end: true
    });

    // Start
    console.log("Build start");
    await asyncFn(cb=>container.start(extraRunConfig, cb));

    // Wait for complete
    const result = await asyncFn(cb=>container.wait(cb));

    console.log("Running post build");
    await buildConfig[name].postBuild();
    console.log("Build completed");
    console.log(result);
  } catch (e){
    console.error("Build failed.");
    console.error(e.stack || e);
  } finally {
    if (container){
      container.remove(()=>{}); // Do not wait for this.
    }
    building = false;
    if (pendingBuild.length){
      const next = pendingBuild.shift();
      delete pendingBuildMap[next];
      startBuild(next);
    }
  }
}

async function clearExpired(){
  console.log("Start clearing");
  const usage = {};

  function shouldNotRemove(Id){
    usage[Id] = (usage[Id]||0)+1;
  }

  function release(Id){
    --usage[Id];
  }

  // Clear expired containers.
  const containers = await asyncFn(cb=>docker.listContainers({all:1}, cb));
  for (let i = 0; i < containers.length; i++){

    const info = containers[i];
    const container = docker.getContainer(info.Id);
    const stats = await asyncFn(cb=>container.inspect(cb));

    const finishedAt = new Date(stats.State.FinishedAt);
    const createdAt = new Date(stats.Created);
    const lastUpdateTime = finishedAt > createdAt ? finishedAt : createdAt;

    if (!stats.State.Running && Date.now() - lastUpdateTime.getTime() > 30*60*1000) {
      console.log(stats.Name+'('+stats.Id+') outdated');
      await asyncFn(cb=>container.remove(cb));
    } else {
      shouldNotRemove(stats.Image);
    }
  }

  // Clear unused Images;

  const images = await asyncFn(cb=>docker.listImages({all:1}, cb));

  async function removeImage(Id){
    if (usage[Id]){
      return;
    }
    const image = docker.getImage(Id);
    let stats

    // Try to remove image
    try {
      stats = await asyncFn(cb=>image.inspect(cb));
      if (stats.RepoTags.length){
        // Do not clear image with tag.
        return;
      }
      await asyncFn(cb=>image.remove(cb));
    } catch(e){
      console.error(stats);
      console.error(e.stack || e);
      return;
    }
    console.log(Id, "removed");

    shouldNotRemove(Id);
    release(stats.Parent);
    await removeImage(stats.Parent);
  }

  for (let i = 0; i < images.length; i++){
    const info = images[i];
    const image = docker.getImage(info.Id);
    try {
      const stats = await asyncFn(cb=>image.inspect(cb));
      shouldNotRemove(stats.Parent);
    } catch (e){}
  }
  for (let i = 0; i < images.length; i++){
    await removeImage(images[i].Id);
  }
}

clearExpired().catch(e=>console.error(e.stack||e));
setInterval(()=>clearExpired().catch(e=>console.error(e.stack||e)), 15*60*1000);

const app = new Koa();

app.use((ctx, next) => {
  return next()
    .catch(err => {
      ctx.body = {
        message: err.message,
      };
      ctx.status = err.status;
    });
});

app.use(bodyParser());

const router = new Router();

const reactnativecntasks = {
  'refs/heads/master': 'test',
  'refs/heads/stable': 'main',
  'refs/heads/router': 'router',
};

router.post('/reactnativecn', async (ctx) => {
  const task = reactnativecntasks[ctx.request.body.ref];

  setTimeout(() => {
    startBuild(task);
  }, 100);

  ctx.body = {ok:1};
});

router.post('/reactnativedocscn', async (ctx) => {
  if (ctx.request.body.ref == 'refs/heads/master') {
    startBuild('docs');
  }
  ctx.body = {ok:1};
})

app.use(router.routes());

// Start port listening
app.listen(3099);

console.log("Ready");