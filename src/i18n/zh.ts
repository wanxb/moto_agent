// 中文翻译字典（spec 010）。

export const zh: Record<string, string> = {
  // ── 通用 ──
  'general.vehicle_not_found': '没有找到车辆「{0}」。',
  'general.vehicle_not_found_add': '没有找到车辆「{0}」，可以先说"添加一辆车 {0}"。',
  'general.no_records': '暂无{0}。',
  'general.no_fuel_records': '暂无加油记录。',
  'general.no_fuel_records_edit': '没有可修改的加油记录。',
  'general.no_fuel_records_delete': '没有可删除的加油记录。',
  'general.fallback_error': '出错了，请稍后重试。',
  'general.future_date': '日期 {0} 还没到（今天 {1}），不能录将来的记录。如果是补录请确认日期无误。',
  'general.unknown_tool': '未知工具：{0}',
  'general.no_reply': '（无回复）',
  'general.timeout': '处理超时，请重试。',
  'general.tool_error': '工具执行失败：{0}',
  'general.need_one_attr': '请至少指定一个要修改的属性（品牌/型号/油号/油箱容量/颜色）。',
  'general.cleared': '已清空',
  'general.authorized_only': '抱歉，无访问权限。',
  'general.api_no_text': '缺少 text',
  'general.api_error': '处理失败',
  'general.rate_limit': '消息有点频繁，请等 {0} 秒再发 🕐',
  'general.no_voice_text': '没听清，请再说一遍或直接打字。',
  'general.record_count': '共 {0} 条',

  // ── 账号绑定（spec 016，仅 TG 发起，链接式）──
  'bind.usage': '用法：/bind 你的邮箱',
  'bind.rate_limited': '操作太频繁，请稍后再试 🕐',
  'bind.mail_failed': '验证链接发送失败，请稍后重试。',
  'bind.link_sent': '✅ 验证链接已发送到 {0}，点击邮件中的链接完成绑定（10 分钟内有效）。',
  'bind.merge_dups': '🔗 账号已合并。检测到 {0} 处可能重复的车辆（{1}）——两边各建过同名车。可在车辆管理查看，或对我说"把重复的车合并一下"。',

  // ── 属性标签 ──
  'attr.brand': '品牌',
  'attr.model': '型号',
  'attr.fuel_type': '油号',
  'attr.tank_capacity': '油箱容量',
  'attr.color': '颜色',

  // ── 车辆工具 ──
  'vehicle.added_default': '✅ 已添加车辆「{0}」，已设为默认车。',
  'vehicle.added': '✅ 已添加车辆「{0}」。',
  'vehicle.already_exists': '车辆「{0}」已存在。',
  'vehicle.no_vehicles': '还没有车辆，可以说"添加一辆车 小绿"。',
  'vehicle.list_title': '🏍 车辆列表',
  'vehicle.default_mark': '（默认）',
  'vehicle.set_default_ok': '✅ 已将默认车设为「{0}」。',
  'vehicle.rename_same': '新旧名称相同，无需修改。',
  'vehicle.rename_clash': '已存在车辆「{0}」，换个名字吧。',
  'vehicle.renamed': '✅ 已将车辆「{0}」改名为「{1}」。',
  'vehicle.alias_removed': '✅ 已移除「{0}」的简称。',
  'vehicle.alias_clash': '已存在车辆或简称「{0}」，换个简称吧。',
  'vehicle.alias_set': '✅ 已将「{0}」的简称设为「{1}」。',
  'vehicle.updated': '✅ 「{0}」已更新：{1}',

  // ── 加油工具 ──
  'fuel.recorded': '✅ 已记录{0}',
  'fuel.vehicle_tag': '（{0}）',
  'fuel.odometer': '📍 里程：{0} km',
  'fuel.fueling': '⛽ 加油：{0} L × ¥{1}/L = ¥{2}',
  'fuel.first_record': '📊 首次记录，下次加油后将显示油耗',
  'fuel.consumption': '📊 本次油耗：{0} L/100km（距上次 {1} km）',
  'fuel.odometer_anomaly': '里程 {0} km 比上一条记录还低，是否里程录入有误？请确认。',
  'fuel.stats_title': '📊 {0} · 油耗统计',
  'fuel.stats_title_default': '📊 油耗统计',
  'fuel.only_one': '只有 1 条记录，需要至少 2 条才能计算区间油耗。',
  'fuel.data_abnormal': '数据异常，无法计算。',
  'fuel.avg': '平均 {0} L/100km',
  'fuel.total': '总计 ¥{0} / {1} km',
  'fuel.last_title': '🕐 最近一次加油{0}',
  'fuel.last_date': '日期：{0}',
  'fuel.last_odometer': '里程：{0} km',
  'fuel.last_detail': '加油：{0} L，¥{1}（¥{2}/L）',
  'fuel.last_fuel_type': '油品：{0}号',
  'fuel.edited': '✏️ 已修改最近一条加油记录{0}',
  'fuel.need_fields': '请说明要修改什么（里程、升数、价格、油品或日期）。',
  'fuel.deleted': '🗑 已删除最近一条加油记录{0}',
  'fuel.deleted_detail': '（如需恢复请联系管理员）',
  'fuel.edit_summary': '📍 里程：{0} km\n⛽ {1} L × ¥{2}/L = ¥{3}\n📅 {4} · {5}号',

  // ── ambiguous 反问 ──
  'ambiguous.record': '记到',
  'ambiguous.query': '查询',
  'ambiguous.edit': '修改',
  'ambiguous.delete': '删除',
  'ambiguous.set': '设到',
  'ambiguous.cancel': '取消',
  'ambiguous.msg': '请指明{0}哪辆车（你有：{1}）。',

  // ── 里程工具 ──
  'mileage.recorded': '✅ 里程已记录{0}：{1} km（{2}）',

  // ── 维保工具 ──
  'maint.recorded': '✅ 已记录保养{0}',
  'maint.parts': '🔧 {0}',
  'maint.no_records': '暂无「{0}」保养记录{1}。',
  'maint.last_title': '🔧 最近一次「{0}」{1}',
  'maint.list_title': '🔧 {0}',
  'maint.list_title_default': '🔧 保养记录',
  'maint.list_title_vehicle': '🔧 {0} · {1}',
  'maint.records_word': '保养记录',
  'maint.record_count': '共 {0} 条记录',
  'maint.more_records': '（还有 {0} 条记录，查看全部请说"保养记录"）',

  // ── 提醒工具 ──
  'reminder.mileage_need': '里程提醒需要给"间隔公里数"或"目标里程"其中之一。',
  'reminder.date_need': '日期提醒需要给一个到期日期（如 2027-01-05）。',
  'reminder.no_basis': '还没有里程或保养记录作基准，请先记录里程，或直接给目标里程（如"机油到 13000 提醒"）。',
  'reminder.basis_note': '（上次 {0} km + {1}）',
  'reminder.renew_note': '\n（每 {0} km 自动续期）',
  'reminder.mileage_set': '{0}\n{1} · 里程达到 {2} km 时提醒{3}{4}',
  'reminder.mileage_updated': '{0}\n{1} · 里程达到 {2} km 时提醒{3}{4}',
  'reminder.date_set': '{0}\n{1} · {2} 到期时提醒',
  'reminder.date_updated': '{0}\n{1} · {2} 到期时提醒',
  'reminder.updated_prefix': '🔁 已更新提醒{0}',
  'reminder.set_prefix': '🔔 已设置提醒{0}',
  'reminder.list_empty': '暂无提醒{0}。',
  'reminder.list_title': '🔔 提醒列表{0}',
  'reminder.cancelled': '✅ 已取消「{0}」提醒（{1} 条）。',
  'reminder.cancel_not_found': '没有找到活跃的「{0}」提醒。',

  // ── Cron 到期推送（spec 016 T10B）──
  'cron.tag': '（{0}）',
  'cron.mileage_msg': '🔔 保养提醒{0}\n该处理「{1}」了：当前 {2} km ≥ 提醒里程 {3} km{4}',
  'cron.date_msg': '🔔 提醒{0}\n{1} 到期：{2}',
  // 提醒次数提示（{0}=第N次）
  'cron.remind_count': '（第 {0} 次提醒）',

  // ── 入口 ──
  'welcome.title': '👋 摩托车油耗管理助手',
  'welcome.body': '\n\n直接发消息记录加油或查询统计，例如：\n• 刚加了 10 升 95 号，花了 98 块，里程 12580\n• 查一下最近 3 个月油耗\n• 上次什么时候加的油\n\n命令：/stats 本月统计  /last 最近记录  /help 帮助',
  'help.title': '📖 使用方法',
  'help.body': '\n\n记录加油：说出加油信息即可\n  "今天加了 10 升，花了 98，里程 12580"\n\n查询油耗：\n  "最近 3 个月油耗"  "本月统计"  "最近 5 次"\n\n快捷命令：\n  /stats  本月油耗统计\n  /last   最近一次加油记录',
  'voice.too_long': '语音有点长（{0}s），请控制在 {1} 秒内，或直接打字。',
  'voice.stt_failed': '语音识别失败，请再说一遍或直接打字。',
  'voice.heard': '🎙 听到：{0}',
  'dashboard.no_url': '⚠️ 未配置 Dashboard 地址，请联系管理员设置 DASHBOARD_URL。',
  'dashboard.link': '📊 <a href="{0}">打开 Moto Agent Dashboard</a>',
  'lang.switched': '✅ 语言已切换为{0}。',
  'lang.unknown': '支持的语言：zh（中文）、en（English）。示例：/lang en',

  // ── 内联键盘按钮 ──
  'button.stats': '📊 本月统计',
  'button.last': '🕐 最近记录',
  'button.dashboard': '📊 Dashboard',
  'button.lang_to_en': '🌐 English',
  'button.lang_to_zh': '🌐 中文',

  // ── 快捷命令 ──
  'shortcut.last': '获取最近一次加油记录',
  'shortcut.stats': '查询本月油耗统计',

  // ── 知识库 RAG（spec 015）──
  'knowledge.empty_query': '请输入要搜索的问题。',
  'knowledge.embed_failed': '知识库检索失败（向量化错误），请稍后重试。',
  'knowledge.search_failed': '知识库检索失败（搜索错误），请稍后重试。',
  'knowledge.no_results': '📖 知识库中未找到相关信息。建议去专业维修站咨询。',

  // ── 去重 & 删除（spec 017）──
  'dup.fuel_warn': '⚠️ 疑似重复加油记录\n{0} 已有一条 {1} km 的记录，与本次 {2} km 相差仅 {3} km。\n确认要继续记录吗？回复"确认"继续。',
  'dup.maint_warn': '⚠️ 疑似重复保养记录\n{1} 附近已有一条「{0}」记录。\n确认要继续记录吗？回复"确认"继续。',
  'delete.recover_hint': '（如需恢复请联系管理员）',
  'delete.fuel_confirm': '⚠️ 确定删除这条加油记录吗{0}？\n{1}\n回复"确认"继续。',
  'delete.fuel_done': '🗑 已删除加油记录{0}',
  'delete.fuel_not_found': '没有找到匹配的加油记录（请说明日期或里程）。',
  'delete.fuel_multi': '找到多条匹配的加油记录，请说明删哪一条：\n{0}',
  'delete.maint_confirm': '⚠️ 确定删除这条保养记录吗{0}？\n{1}\n回复"确认"继续。',
  'delete.maint_done': '🗑 已删除保养记录{0}',
  'delete.maint_not_found': '没有找到匹配的保养记录。',
  'delete.maint_multi': '找到多条匹配的保养记录，请说明删哪一条，或说"只保留一条"删除重复：\n{0}',
  'delete.maint_keep_one_confirm': '⚠️ 找到 {0} 条重复保养记录{1}，将保留最早一条、删除其余 {2} 条：\n{3}\n回复"确认"继续。',
  'delete.maint_kept_one': '🗑 已删除 {0} 条重复保养记录{1}，保留最早一条。',

  // ── 单位 ──
  'unit.km': 'km',
  'unit.l': 'L',
  'unit.l_per_100km': 'L/100km',
  'unit.yuan_per_l': '¥{0}/L',
};
