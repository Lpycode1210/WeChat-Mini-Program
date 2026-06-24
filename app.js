App({
  onLaunch() {
    const user = wx.getStorageSync('ai_calendar_user') || {}
    wx.login({
      success: (res) => {
        this.globalData.loginCode = res.code
      }
    })
    this.globalData.userInfo = user
  },
  globalData: {
    userInfo: null,
    loginCode: ''
  }
})
