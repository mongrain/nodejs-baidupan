# nodejs-baidupan

> nodejs实现一个百度网盘api的接入，支持 `上传`，`下载服务`

目前仅实现作者使用的功能，如果有其他的功能想要实现，欢迎 `PR` 。

如果你想玩转这个项目，那么你应该按照以下流程进行

- [ ] 调用 getCode 函数
- [ ] 调用 getAccessTokenByCode 函数
- [ ] 调用 upload 函数 
- [ ] 调用 getFileSource 函数

### getCode 函数
  生成临时 code ，并打印二维码地址，等待用户扫码授权后。使用该 code 兑换 access_token

### getAccessTokenByCode 函数
  以获取 access_token 并会自动写入 ctx.json

### upload 上传文件
  这里我做了一层封装，以 ossUrl 为入参，下载并上传文件，如果不需要则，直接删除 102 行代码，传入文件的物理地址即可。

### getFileSource 
  通过文件名 获取百度网盘地址

