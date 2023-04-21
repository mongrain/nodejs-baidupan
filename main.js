const qs = require('querystring');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const url = require('url');
const crypto = require('crypto');
const { execSync } = require('child_process');

const moment = require('moment');
const request = require('request');

const ROOT_PATH = '/apps/file/'; //网盘路径
const { CTX } = require('./utils');
// 获取上下文
const ctx = CTX.get();
// 上下文中填写的百度网盘的API_KEY和SECRET_KEY
const API_KEY = ctx.API_KEY;
const SECRET_KEY = ctx.SECRET_KEY;
// device 模式下兑换出来的 code
let device_code = '';

/**
 * 通过文件名 获取百度网盘地址
 * @param file
 * @param path
 * @returns {Promise<string>}
 */
function getFileSource(file = '', path = ROOT_PATH) {
  const ctx = CTX.get();
  const ACCESS_TOKEN = ctx.access_token;
  return findFilesByDir(path, file)
    .then((file => findFsId(file)))
    .then(file => `${file.dlink}&access_token=${ACCESS_TOKEN}`)

  function findFilesByDir(path, keyword) {
    const options = {
      'method': 'GET',
      'url': `http://pan.baidu.com/rest/2.0/xpan/file?dir=${path}&access_token=${ACCESS_TOKEN}&page=1&num=1&method=search&key=${keyword}`,
      'headers': {
        'User-Agent': 'pan.baidu.com'
      }
    };
    return new Promise((resolve) => {
      request(options, function (error, response) {
        if (error) throw new Error(error);
        resolve(JSON.parse(response.body).list[0]);
      });
    })

  }

  async function findFsId(file) {
    const options = {
      'method': 'GET',
      'url': `http://pan.baidu.com/rest/2.0/xpan/multimedia?method=filemetas&access_token=${ACCESS_TOKEN}&fsids=%5B${file.fs_id}%5D&dlink=1`,
      'headers': {
        'User-Agent': 'pan.baidu.com'
      }
    };

    return await new Promise((resolve) => {
      request(options, function (error, response) {
        if (error) throw new Error(error);
        const res = JSON.parse(response.body);
        const file = res.list[0];
        // file  ---
        // {
        //   category: 2,
        //   dlink: 'https://d.pcs.baidu.com/file/5fa33534eg14acdc473c255429c11efe?fid=1582192676-250528-643735673460423&rt=pr&sign=FDtAERV-DCb740ccc5511e5e8fedcff06b081203-BT0dw1GVrkelJypec8C3gXA%2BKhk%3D&expires=8h&chkbd=0&chkv=3&dp-logid=581378689941771941&dp-callid=0&dstime=1680411761&r=112323112&origin_appid=31886974&file_type=0',
        //   filename: 'M500002bwzGZ31Y0nN.mp3',
        //   fs_id: 643735673460423,
        //   isdir: 0,
        //   md5: '5fa33534eg14acdc473c255429c11efe',
        //   oper_id: 1582192676,
        //   path: '/apps/file/M500002bwzGZ31Y0nN.mp3',
        //   server_ctime: 1680400708,
        //   server_mtime: 1680400708,
        //   size: 3726342
        // }
        resolve(file)
      });
    })

  }
}

/**
 * 上传文件到网盘
 * @param oss
 */
function upload(oss) {
  const ctx = CTX.get();
  const ACCESS_TOKEN = ctx.access_token;
  const href = oss.split('?')[0];
  const filename = href.slice(href.lastIndexOf('/') + 1);
  const filePath = path.resolve(__dirname, `./tmp/${filename}`);
  const cwd = path.resolve(__dirname, './tmp');
  const folderName = `${filename}.folder`;
  const folderPath = path.resolve(__dirname, `./tmp/${folderName}`);

  return downloadFile(oss, filePath)
    .then(() => preUpload(filePath))
    .then(async (preUploadResult) => {
      for (const block of preUploadResult.block_list) {
        await chunkUpload({ uploadid: preUploadResult.uploadid, partseq: block });
      }
      return createUpload({ uploadid: preUploadResult.uploadid, block_list: preUploadResult.postData.block_list, size: preUploadResult.postData.size })
    })
    .then(() => filename)

  /**
   * 下载文件函数
   * @param {string} ossUrl - OSS 文件地址
   * @param {string} filePath - 本地保存文件的路径
   */
  function downloadFile(ossUrl, filePath) {
    return new Promise((resolve) => {
      // 解析 URL
      const parsedUrl = url.parse(ossUrl);

      // 根据协议创建 HTTP(S) 请求对象
      const req = parsedUrl.protocol === 'https:' ? https.request(parsedUrl) : http.request(parsedUrl);

      // 处理响应
      req.on('response', (res) => {
        if (res.statusCode !== 200) {
          reject(`下载失败，HTTP 状态码为 ${res.statusCode}`);
          return;
        }

        // 创建可写流
        const fileStream = fs.createWriteStream(filePath);

        // 接收数据并写入文件
        res.pipe(fileStream);

        // 下载完成时关闭可写流并调用回调函数
        fileStream.on('close', () => {
          resolve(null);
        });
      });

      // 处理请求错误
      req.on('error', (err) => {
        reject(`下载失败，错误信息为 ${err.message}`);
      });

      // 发送请求
      req.end();
    })
  }

  async function preUpload(filePath) {
    const options = {
      'method': 'POST',
      'hostname': 'pan.baidu.com',
      'path': '/rest/2.0/xpan/file?method=precreate&access_token=' + ACCESS_TOKEN,
      'headers': {
        'User-Agent': 'pan.baidu.com',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      'maxRedirects': 20
    };

    const fileSize = await getFileSize(filePath);
    const block_list = await splitAndGetMD5();

    return new Promise((resolve) => {
      var postData = qs.stringify({
        'path': ROOT_PATH + filename,
        'size': fileSize,
        'isdir': '0',
        'autoinit': '1',
        'rtype': '3',
        block_list: JSON.stringify(block_list)
      });

      const req = https.request(options, function (res) {
        var chunks = [];

        res.on("data", function (chunk) {
          chunks.push(chunk);
        });

        res.on("end", function (chunk) {
          var body = Buffer.concat(chunks);
          const res = JSON.parse(body.toString());
          resolve({
            postData: {
              size: fileSize,
              block_list: JSON.stringify(block_list)
            },
            ...res,
          });
        });

        res.on("error", function (error) {
          console.error(error);
        });
      });

      req.write(postData);

      req.end();
    })

    function getFileSize(path) {
      return new Promise((resolve) => {
        fs.stat(path, (err, stats) => {
          if (err) {
            console.error(err);
          } else {
            resolve(stats.size);
          }
        });
      })
    }

    async function splitAndGetMD5() {
      await deleteFolderRecursive(folderPath);
      execSync(`mkdir ${folderName}`, { cwd });
      execSync(`split -b 4m ${filename} ${folderName}/`, { cwd });
      const files = await readDir(folderPath);
      const md5s = [];
      for (const filePath of files) {
        const md5 = await getFileMd5(filePath);
        md5s.push(md5);
      }
      return (md5s);
    }

    function deleteFolderRecursive(folderPath) {
      return new Promise((resolve, reject) => {
        if (!fs.existsSync(folderPath)) {
          resolve();
          return;
        }

        const files = fs.readdirSync(folderPath);

        Promise.all(files.map((file) => {
          const filePath = path.join(folderPath, file);
          if (fs.lstatSync(filePath).isDirectory()) {
            return deleteFolderRecursive(filePath);
          } else {
            return fs.promises.unlink(filePath);
          }
        })).then(() => {
          return fs.promises.rmdir(folderPath);
        }).then(() => {
          resolve();
        }).catch((err) => {
          reject(err);
        });
      });
    }

    function getFileMd5(filePath) {
      return new Promise((resolve, reject) => {
        const hash = crypto.createHash('md5');
        const stream = fs.createReadStream(filePath);

        stream.on('error', err => {
          reject(err);
        });

        stream.on('data', chunk => {
          hash.update(chunk);
        });

        stream.on('end', () => {
          const md5 = hash.digest('hex');
          console.log(md5);
          resolve(md5);
        });
      });
    }
  }

  async function chunkUpload({ uploadid, partseq }) {
    const files = await readDir(folderPath);
    const filepath = path.resolve(files[partseq]);
    const options = {
      'method': 'POST',
      'url': `https://d.pcs.baidu.com/rest/2.0/pcs/superfile2?access_token=${ACCESS_TOKEN}&method=upload&type=tmpfile&path=${encodeURI(ROOT_PATH + filename)}&uploadid=${uploadid}&partseq=${partseq}`,
      formData: {
        'file': {
          'value': fs.createReadStream(filepath),
          'options': {
            'filename': filepath,
            'contentType': null
          }
        }
      }
    };
    return new Promise((resolve) => {
      request(options, function (error, response) {
        if (error) throw new Error(error);
        resolve(response.body);
      });
    })
  }

  async function createUpload({ uploadid, block_list, size }) {
    var options = {
      'method': 'POST',
      'url': 'https://pan.baidu.com/rest/2.0/xpan/file?method=create&access_token=' + ACCESS_TOKEN,
      'headers': {
        'User-Agent': 'pan.baidu.com',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      form: {
        'path': ROOT_PATH + filename,
        'size': size,
        'isdir': '0',
        'rtype': '3',
        'uploadid': uploadid,
        'block_list': block_list,
      }
    };
    request(options, function (error, response) {
      if (error) throw new Error(error);
      console.log(response.body);
    });

  }

  function readDir(dirPath) {
    return new Promise((resolve, reject) => {
      fs.readdir(dirPath, (err, files) => {
        if (err) {
          reject(err);
          return;
        }

        const promises = files.map(file => {
          const filePath = path.join(dirPath, file);
          return new Promise((resolve, reject) => {
            fs.stat(filePath, (err, stats) => {
              if (err) {
                reject(err);
                return;
              }

              if (stats.isDirectory()) {
                readDir(filePath).then(files => {
                  resolve(files);
                }).catch(err => {
                  reject(err);
                });
              } else {
                resolve(filePath);
              }
            });
          });
        });

        Promise.all(promises).then(files => {
          const flattened = files.reduce((acc, cur) => {
            return acc.concat(cur);
          }, []);

          resolve(flattened);
        }).catch(err => {
          reject(err);
        });
      });
    });
  }
}

/**
 * 获取通过设备模式获取 code
 */
function getCode() {
  const request = require('request');
  const options = {
    'method': 'GET',
    'url': `https://openapi.baidu.com/oauth/2.0/device/code?response_type=device_code&client_id=${API_KEY}&scope=basic,netdisk`,
    'headers': {
      'User-Agent': 'pan.baidu.com',
    }
  };

  request(options, function (error, response) {
    if (error) throw new Error(error);
    const res = JSON.parse(response.body);
    const expires_date = moment((Date.now() + res.expires_in * 1000)).format('YYYY-MM-DD HH:mm:ss');
    // 这里打印即可，不需要存储到 ctx 中
    console.log({ ...res, expires_date })
  });
}

/**
 * 通过 code 获取token
 */
function getAccessTokenByCode() {
  const options = {
    'method': 'GET',
    'url': `https://openapi.baidu.com/oauth/2.0/token?grant_type=device_token&code=${device_code}&client_id=${API_KEY}&client_secret=${SECRET_KEY}`,
    'headers': {
      'User-Agent': 'pan.baidu.com',
    }
  };
  request(options, function (error, response) {
    if (error) throw new Error(error);
    const res = JSON.parse(response.body);
    const expires_date = moment((Date.now() + res.expires_in * 1000)).format('YYYY-MM-DD HH:mm:ss');
    // expires_in
    CTX.set({ ...res, expires_date })
  });
}

function refreshToken() {
  const ctx = CTX.get();
  const options = {
    'method': 'GET',
    'url': `https://openapi.baidu.com/oauth/2.0/token?grant_type=refresh_token&refresh_token=${ctx.refresh_token}&client_id=${API_KEY}&client_secret=${SECRET_KEY}`,
    'headers': {
      'User-Agent': 'pan.baidu.com'
    }
  };
  request(options, function (error, response) {
    if (error) throw new Error(error);
    const res = JSON.parse(response.body);
    const expires_date = moment((Date.now() + res.expires_in * 1000)).format('YYYY-MM-DD HH:mm:ss');
    console.log('刷新 token 成功 res', res);
    // expires_in
    CTX.set({ ...res, expires_date });
  });
}

// ============= demo ================
// 获取 code
// getCode();
// 把打印出来的 device_code 粘贴到 21 行 并且打开 qrcode_url ，用手机百度网盘软件扫码后允许
// getAccessTokenByCode()
// 获取到对应信息 {
//   "expires_date": "2023-05-21 22:22:38",
//   "expires_in": 2592000,
//   "refresh_token": "127.c68e67e99f193f516652d4bfbf784a4b.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
//   "access_token": "126.70dc2a89835ba968d55af582905d9838.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
//   "session_secret": "",
//   "session_key": "",
//   "scope": "basic netdisk"
// }
// 尝试上传
// upload('https://www.runoob.com/try/demo_source/movie.mp4');
// 得到文件名称 movie.mp4
// 查看百度地址
// getFileSource('movie.mp4').then(url => {
//   console.log('url', url)
// })
// 打印 url https://d.pcs.baidu.com/file/ce09092cbl5ebc3b7971e2b2a453ee4d?fid=1582192676-250528-110607584533389&rt=pr&sign=FDtAERV-DCb740ccc5511e5e8fedcff06b081203-RJ965j%2BHMsEhZ3dvXpzFhnBxc9c%3D&expires=8h&chkbd=0&chkv=3&dp-logid=643441440819559584&dp-callid=0&dstime=1682087420&r=146716351&origin_appid=31886974&file_type=0&access_token=126.70dc2a89835ba968d55af582905d9838.Ygk9cAn4bs6AZ_Dy3-OLMuRi_hmwdosYyhu7OSL.w8S5FA
