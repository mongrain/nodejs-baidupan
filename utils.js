const fs = require('fs');
const path = require('path');

/**
 * 获取上下文
 */
function getCtx() {
  return JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "./ctx.json")).toString()
  );
}

function setCtx(ctx) {
  const ctx1 = getCtx();
  fs.writeFileSync(
    path.resolve(__dirname, "./ctx.json"),
    JSON.stringify({ ...ctx1, ...ctx }, null, 2)
  );
}

exports.CTX = {
  get: getCtx,
  set: setCtx
};
