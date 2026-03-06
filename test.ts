fetch('http://localhost:8082/jimeng/images/generations', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    openid: 'oPpHA68DncFCupsADGwXE-JTeGuc',
  },
  body: JSON.stringify({
    model: 'jimeng-4.6',
    prompt: `以小偶像为主题，立绘，面部特征精致，表情迷人，妆容俏皮，头发柔软而蓬松，带有自然的波浪，穿着风格独特，以紫色为主，自由感，梦幻感，营造出充满故事感氛围的画面。长发，，精致的脸庞，完美的眼睛，洛丽塔，紫色，摆pose,白色描线边描出人物轮廓，周围贴有可爱小贴纸，写上白色小英文`,
    ratio: '9:16',
    resolution: '2k',
  }),
})
  .then((response) => response.json())
  .then((data) => {
    console.log(data)
  })
  .catch((error) => {
    console.error('Error:', error)
  })
