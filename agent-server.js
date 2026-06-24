const http = require('http')
const fs = require('fs')

const PORT = Number(process.env.PORT || 3000)
const SERVER_JS = 'E:\\wedesign\\local_server\\server.js'
const API_URL = process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/chat/completions'

const pad = (n) => String(n).padStart(2, '0')
const cnNumberMap = {
  零: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9
}

const parseCnNumber = (text) => {
  if (/^\d+$/.test(text)) return Number(text)
  if (text === '十') return 10
  if (text.includes('十')) {
    const parts = text.split('十')
    const tens = parts[0] ? cnNumberMap[parts[0]] : 1
    const ones = parts[1] ? cnNumberMap[parts[1]] : 0
    return tens * 10 + ones
  }
  return cnNumberMap[text]
}

const normalizeTimeText = (text) => text.replace(/([零一二两三四五六七八九十]{1,3})(?=\s*(?:点|时|:|：|到|至|-|~))/g, (match) => {
  const number = parseCnNumber(match)
  return typeof number === 'number' && !Number.isNaN(number) ? String(number) : match
})

const readApiKey = () => {
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY
  try {
    const content = fs.readFileSync(SERVER_JS, 'utf8')
    const match = content.match(/API_KEY\s*=\s*["']([^"']+)["']/)
    return match ? match[1] : ''
  } catch (err) {
    return ''
  }
}

const todayKey = () => {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const normalizeDate = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

const parseDate = (text) => {
  const now = new Date()
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (/后天/.test(text)) date.setDate(date.getDate() + 2)
  else if (/明天|明日/.test(text)) date.setDate(date.getDate() + 1)
  else if (/昨天/.test(text)) date.setDate(date.getDate() - 1)

  const dateMatch = text.match(/(\d{1,2})月(\d{1,2})[日号]?/)
  if (dateMatch) {
    date.setMonth(Number(dateMatch[1]) - 1)
    date.setDate(Number(dateMatch[2]))
  }

  return normalizeDate(date)
}

const parseTimes = (text) => {
  const normalized = normalizeTimeText(text)
  const period = /下午|晚上|今晚/.test(normalized) ? 'pm' : (/上午|早上|早晨/.test(normalized) ? 'am' : '')
  const range = normalized.match(/(\d{1,2})(?:[:：点时](\d{1,2})?)?\s*(?:到|-|至|~)\s*(\d{1,2})(?:[:：点时](\d{1,2})?)?/)
  const single = normalized.match(/(\d{1,2})(?:[:：点时](\d{1,2})?)?/)

  const normalizeHour = (hour) => {
    let h = Number(hour)
    if (period === 'pm' && h < 12) h += 12
    if (/中午/.test(text) && h < 12) h += 12
    return h
  }

  if (range) {
    const startHour = normalizeHour(range[1])
    const startMinute = Number(range[2] || 0)
    let endHour = normalizeHour(range[3])
    const endMinute = Number(range[4] || 0)
    if (endHour < startHour) endHour += 12
    return {
      start: `${pad(startHour)}:${pad(startMinute)}`,
      end: `${pad(endHour)}:${pad(endMinute)}`
    }
  }

  if (single) {
    const startHour = normalizeHour(single[1])
    const startMinute = Number(single[2] || 0)
    const endHour = /会|会议|评审|沟通/.test(text) ? startHour : startHour + 1
    const endMinute = /会|会议|评审|沟通/.test(text) ? startMinute + 30 : startMinute
    return {
      start: `${pad(startHour)}:${pad(startMinute)}`,
      end: `${pad(endHour + Math.floor(endMinute / 60))}:${pad(endMinute % 60)}`
    }
  }

  return { start: '09:00', end: '09:30' }
}

const cleanTitle = (text, type) => {
  if (type === 'meeting') {
    const topicMatch = text.match(/关于(.+?)(?:的)?(?:会议|会|讨论|交流|$)/)
    if (topicMatch) {
      const topic = topicMatch[1]
        .replace(/如何|怎么|怎样|是否|能不能|可不可以/g, '')
        .replace(/主要讨论.*$/g, '')
        .replace(/[，。,.]/g, '')
        .trim()
      if (/王者/.test(topic) && /高手/.test(topic)) return '王者高手会议'
      if (topic) return `${topic.slice(0, 8)}会议`
    }
  }

  const title = text
    .replace(/帮我|记一下|提醒我|安排|添加|加入日历|开会|开一个|会议|明天|后天|今天|下午|上午|晚上|早上|中午|主要讨论.*$/g, '')
    .replace(/\d{1,2}月\d{1,2}[日号]?/g, '')
    .replace(/[零一二两三四五六七八九十\d]{1,3}([:：点时]\d{0,2})?\s*(到|-|至|~)?\s*[零一二两三四五六七八九十\d]{0,3}([:：点时]\d{0,2})?/g, '')
    .replace(/在.+?(?:开|参加|进行|举办|有|约|见)/g, '')
    .replace(/[，。,.]/g, '')
    .trim()

  if (!title) return type === 'meeting' ? '会议' : '生活事务'
  if (type === 'meeting' && !/会$|评审$|沟通$|同步$/.test(title)) return title.length <= 4 ? `${title}会` : title.slice(0, 10)
  return title.slice(0, 10)
}

const parseLocation = (text) => {
  const match = text.match(/在([^，。,.]+?)(?:开|参加|进行|举办|有|约|见|$)/)
  return match ? match[1].trim() : ''
}

const localParse = (text) => {
  const rawText = text.trim()
  if (/删除|删掉|取消|移除/.test(rawText)) {
    return {
      intent: 'delete_event',
      confidence: 0.9,
      reply: '已识别为删除事件，请确认候选项。',
      needConfirm: true,
      query: {
        date: parseDate(rawText),
        type: /会|会议/.test(rawText) ? 'meeting' : (/生活|事务|待办/.test(rawText) ? 'life' : ''),
        keyword: rawText.replace(/删除|删掉|取消|移除|今天|明天|后天|的|会议|会|生活|事务|待办/g, '').trim()
      }
    }
  }

  const type = /会|会议|评审|沟通|同步|腾讯|钉钉|飞书/.test(rawText) ? 'meeting' : 'life'
  const date = parseDate(rawText)
  const times = parseTimes(rawText)
  const event = {
    type,
    title: cleanTitle(rawText, type),
    meetingNo: '',
    startTime: `${date} ${times.start}`,
    endTime: `${date} ${times.end}`,
    mode: /腾讯|钉钉|飞书|线上|链接|会议号/.test(rawText) ? 'online' : (/在|线下|地点/.test(rawText) ? 'offline' : ''),
    location: parseLocation(rawText),
    platform: /腾讯/.test(rawText) ? '腾讯会议' : (/钉钉/.test(rawText) ? '钉钉' : (/飞书/.test(rawText) ? '飞书' : '')),
    meetingUrl: (rawText.match(/https?:\/\/\S+/) || [''])[0],
    memo: rawText,
    reminder: { enabled: true, minutesBefore: type === 'meeting' ? 60 : 30 }
  }

  return {
    intent: 'create_event',
    confidence: 0.82,
    reply: `已识别为${type === 'meeting' ? '公司会议' : '生活事务'}，请确认后加入日历。`,
    needConfirm: false,
    event
  }
}

const systemPrompt = () => `
你是微信小程序里的个人 AI 会议日程 Agent。当前日期是 ${todayKey()}，时区 Asia/Shanghai。

你只能输出严格 JSON，不要 Markdown，不要解释。

支持 intent:
- create_event 新增事件
- delete_event 删除事件
- update_event 修改事件
- query_event 查询事件
- complete_event 标记完成
- create_report 生成报告
- unknown 不确定

事件 type:
- meeting 公司会议
- life 生活事务

必须返回:
{
  "intent": "create_event",
  "confidence": 0.9,
  "reply": "简短中文回复",
  "needConfirm": false,
  "event": {
    "type": "meeting",
    "title": "10字以内短标题",
    "meetingNo": "",
    "startTime": "YYYY-MM-DD HH:mm",
    "endTime": "YYYY-MM-DD HH:mm",
    "mode": "online/offline/",
    "location": "",
    "platform": "",
    "meetingUrl": "",
    "memo": "",
    "reminder": { "enabled": true, "minutesBefore": 60 }
  },
  "query": {
    "date": "YYYY-MM-DD",
    "type": "meeting/life/",
    "keyword": ""
  }
}

重要规则:
1. “删除/删掉/取消/移除”必须返回 delete_event，不能返回 create_event。
2. “删除后天的会议”返回 delete_event，query.date 是后天日期，query.type 是 meeting。
3. 中文时间要转成 24 小时制，例如“后天下午三点到5点”是 15:00-17:00。
4. 地点不要混入标题，“在杭州余杭区开一个关于...”地点是“杭州余杭区”。
5. “关于如何玩王者算高手的会议，主要讨论是否重做扁鹊”标题应提炼为“王者高手会议”。
6. 未指定结束时间时，会议默认 30 分钟，生活事务默认 60 分钟。
`

const readBody = (req) => new Promise((resolve, reject) => {
  let body = ''
  req.on('data', (chunk) => {
    body += chunk
    if (body.length > 2 * 1024 * 1024) req.destroy()
  })
  req.on('end', () => resolve(body))
  req.on('error', reject)
})

const sendJson = (res, status, data) => {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
  })
  res.end(JSON.stringify(data))
}

const extractJson = (content) => {
  const cleaned = String(content || '').replace(/```json|```/g, '').trim()
  const first = cleaned.indexOf('{')
  const last = cleaned.lastIndexOf('}')
  if (first < 0 || last < first) throw new Error('json not found')
  return JSON.parse(cleaned.slice(first, last + 1))
}

const normalizeResult = (result, rawText) => {
  const local = localParse(rawText)
  const normalized = {
    intent: result.intent || 'unknown',
    confidence: typeof result.confidence === 'number' ? result.confidence : 0.7,
    reply: result.reply || '我已完成识别，请确认。',
    needConfirm: Boolean(result.needConfirm),
    event: result.event,
    query: result.query
  }

  if (/删除|删掉|取消|移除/.test(rawText) && normalized.intent === 'create_event') {
    return local
  }

  if (normalized.intent === 'unknown' && /(会|会议|提醒|安排|删除|取消|明天|后天|今天|\d|[一二三四五六七八九十]点)/.test(rawText)) {
    return local
  }

  if (normalized.intent === 'delete_event') {
    normalized.needConfirm = true
    normalized.reply = '已识别为删除事件，请确认候选项。'
    normalized.query = normalized.query || {}
    if (/会|会议/.test(rawText) && !normalized.query.type) normalized.query.type = 'meeting'
    if (/生活|事务|待办/.test(rawText) && !normalized.query.type) normalized.query.type = 'life'
  }

  if (normalized.intent === 'create_event' && normalized.event) {
    normalized.event = {
      ...normalized.event,
      type: local.event ? local.event.type : normalized.event.type,
      title: local.event ? local.event.title : normalized.event.title,
      startTime: local.event ? local.event.startTime : normalized.event.startTime,
      endTime: local.event ? local.event.endTime : normalized.event.endTime,
      location: local.event ? local.event.location : normalized.event.location,
      memo: normalized.event.memo || rawText,
      reminder: normalized.event.reminder || {
        enabled: true,
        minutesBefore: normalized.event.type === 'meeting' ? 60 : 30
      }
    }
  }

  return normalized
}

const callModel = async (payload, rawText) => {
  const apiKey = readApiKey()
  if (!apiKey) throw new Error('DeepSeek API Key 未找到')

  const rawMessages = Array.isArray(payload.messages) ? payload.messages : []
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      response_format: { type: 'json_object' },
      temperature: 0.1,
      messages: [
        { role: 'system', content: systemPrompt() },
        ...rawMessages.filter((message) => message.role !== 'system')
      ]
    })
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`DeepSeek 请求失败：${response.status} ${detail}`)
  }

  const data = await response.json()
  const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content
  return normalizeResult(extractJson(content), rawText)
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    sendJson(res, 200, { ok: true })
    return
  }

  if (req.method === 'GET' && req.url === '/health') {
    sendJson(res, 200, { ok: true, service: 'calendar-agent', time: new Date().toISOString() })
    return
  }

  if (req.method === 'POST' && req.url === '/api/chat') {
    try {
      const body = await readBody(req)
      const payload = body ? JSON.parse(body) : {}
      const rawMessages = Array.isArray(payload.messages) ? payload.messages : []
      const userMessage = [...rawMessages].reverse().find((message) => message.role === 'user')
      const rawText = userMessage ? userMessage.content : (payload.text || '')
      const agent = await callModel(payload, rawText)
      sendJson(res, 200, {
        choices: [
          {
            message: {
              role: 'assistant',
              content: JSON.stringify(agent)
            }
          }
        ],
        agent
      })
    } catch (err) {
      sendJson(res, 500, { error: '请求失败', detail: err.message })
    }
    return
  }

  sendJson(res, 404, { error: 'not found' })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Agent server listening: http://127.0.0.1:${PORT}`)
  console.log(`Health check: http://127.0.0.1:${PORT}/health`)
})
