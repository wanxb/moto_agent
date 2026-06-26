// English translation dictionary (spec 010).

export const en: Record<string, string> = {
  // ── General ──
  'general.vehicle_not_found': 'Vehicle "{0}" not found.',
  'general.vehicle_not_found_add': 'Vehicle "{0}" not found. Try "add vehicle {0}" first.',
  'general.no_records': 'No {0} yet.',
  'general.no_fuel_records': 'No fuel records yet.',
  'general.no_fuel_records_edit': 'No fuel records to edit.',
  'general.no_fuel_records_delete': 'No fuel records to delete.',
  'general.fallback_error': 'Something went wrong. Please try again later.',
  'general.unknown_tool': 'Unknown tool: {0}',
  'general.no_reply': '(No reply)',
  'general.timeout': 'Request timed out. Please try again.',
  'general.tool_error': 'Tool execution failed: {0}',
  'general.need_one_attr': 'Please specify at least one attribute to update (brand/model/fuel_type/tank_capacity/color).',
  'general.cleared': 'Cleared',
  'general.authorized_only': 'Sorry, you do not have access.',
  'general.api_no_text': 'Missing text',
  'general.api_error': 'Processing failed',
  'general.rate_limit': 'Too many messages. Please wait {0}s 🕐',
  'general.no_voice_text': "Didn't catch that. Please speak again or type.",

  // ── Account binding (spec 016, Telegram-initiated, link-based) ──
  'bind.usage': 'Usage: /bind your@email.com',
  'bind.rate_limited': 'Too many attempts, please try again later 🕐',
  'bind.mail_failed': 'Failed to send the verification link, please retry.',
  'bind.link_sent': '✅ A verification link was sent to {0}. Click it to finish binding (valid for 10 min).',
  'bind.merge_dups': '🔗 Account merged. Found {0} possibly-duplicate vehicle(s) ({1}) — both sides had the same name. Check Vehicles, or tell me to merge the duplicates.',

  // ── Attribute labels ──
  'attr.brand': 'Brand',
  'attr.model': 'Model',
  'attr.fuel_type': 'Fuel Grade',
  'attr.tank_capacity': 'Tank Capacity',
  'attr.color': 'Color',

  // ── Vehicle tools ──
  'vehicle.added_default': '✅ Added "{0}" and set as default.',
  'vehicle.added': '✅ Added "{0}".',
  'vehicle.already_exists': 'Vehicle "{0}" already exists.',
  'vehicle.no_vehicles': 'No vehicles yet. Try "add vehicle MyBike".',
  'vehicle.list_title': '🏍 Vehicles',
  'vehicle.default_mark': '(default)',
  'vehicle.set_default_ok': '✅ Default vehicle set to "{0}".',
  'vehicle.rename_same': 'New name is the same as the old one.',
  'vehicle.rename_clash': 'Vehicle "{0}" already exists. Choose a different name.',
  'vehicle.renamed': '✅ Renamed "{0}" to "{1}".',
  'vehicle.alias_removed': '✅ Removed alias for "{0}".',
  'vehicle.alias_clash': 'A vehicle or alias "{0}" already exists.',
  'vehicle.alias_set': '✅ Set alias for "{0}" to "{1}".',
  'vehicle.updated': '✅ "{0}" updated: {1}',

  // ── Fuel tools ──
  'fuel.recorded': '✅ Recorded{0}',
  'fuel.vehicle_tag': ' ({0})',
  'fuel.odometer': '📍 Odometer: {0} km',
  'fuel.fueling': '⛽ Fuel: {0} L × {1}/L = {2}',
  'fuel.first_record': '📊 First record — fuel consumption will show after next fill-up.',
  'fuel.consumption': '📊 Fuel consumption: {0} L/100km ({1} km since last)',
  'fuel.odometer_anomaly': 'Odometer {0} km is lower than the previous record — is this correct? Please verify.',
  'fuel.stats_title': '📊 {0} · Fuel Statistics',
  'fuel.stats_title_default': '📊 Fuel Statistics',
  'fuel.only_one': 'Only 1 record — need at least 2 to calculate consumption.',
  'fuel.data_abnormal': 'Data anomaly — cannot calculate.',
  'fuel.avg': 'Average {0} L/100km',
  'fuel.total': 'Total ¥{0} / {1} km',
  'fuel.last_title': '🕐 Last Fuel-up{0}',
  'fuel.last_date': 'Date: {0}',
  'fuel.last_odometer': 'Odometer: {0} km',
  'fuel.last_detail': 'Fuel: {0} L, {1}（{2}/L）',
  'fuel.last_fuel_type': 'Grade: {0}',
  'fuel.edited': '✏️ Updated last fuel record{0}',
  'fuel.need_fields': 'Please specify what to change (odometer, liters, price, fuel grade, or date).',
  'fuel.deleted': '🗑 Deleted last fuel record{0}',
  'fuel.deleted_detail': '(Contact admin to recover)',
  'fuel.edit_summary': '📍 Odometer: {0} km\n⛽ {1} L × {2}/L = {3}\n📅 {4} · {5}',

  // ── Ambiguous ──
  'ambiguous.record': 'record to',
  'ambiguous.query': 'query',
  'ambiguous.edit': 'edit',
  'ambiguous.delete': 'delete',
  'ambiguous.set': 'set reminder for',
  'ambiguous.cancel': 'cancel reminder for',
  'ambiguous.msg': 'Specify which vehicle to {0} (you have: {1}).',

  // ── Mileage ──
  'mileage.recorded': '✅ Mileage recorded{0}: {1} km ({2})',

  // ── Maintenance ──
  'maint.recorded': '✅ Maintenance recorded{0}',
  'maint.parts': '🔧 {0}',
  'maint.no_records': 'No "{0}" maintenance records{1}.',
  'maint.last_title': '🔧 Last "{0}"{1}',
  'maint.list_title': '🔧 {0}',
  'maint.list_title_default': '🔧 Maintenance Records',
  'maint.list_title_vehicle': '🔧 {0} · {1}',
  'maint.records_word': 'Maintenance Records',

  // ── Reminders ──
  'reminder.mileage_need': 'Mileage reminders need either an interval or a target odometer.',
  'reminder.date_need': 'Date reminders need a due date (e.g. 2027-01-05).',
  'reminder.no_basis': 'No mileage or maintenance records to use as baseline. Record mileage first, or specify a target (e.g. "oil change at 13000").',
  'reminder.basis_note': ' (last {0} km + {1})',
  'reminder.renew_note': '\n(Auto-renews every {0} km)',
  'reminder.mileage_set': '{0}\n{1} · Remind when odometer reaches {2} km{3}{4}',
  'reminder.mileage_updated': '{0}\n{1} · Remind when odometer reaches {2} km{3}{4}',
  'reminder.date_set': '{0}\n{1} · Due on {2}',
  'reminder.date_updated': '{0}\n{1} · Due on {2}',
  'reminder.updated_prefix': '🔁 Reminder updated{0}',
  'reminder.set_prefix': '🔔 Reminder set{0}',
  'reminder.list_empty': 'No reminders{0}.',
  'reminder.list_title': '🔔 Reminders{0}',
  'reminder.cancelled': '✅ Cancelled "{0}" reminder ({1} items).',
  'reminder.cancel_not_found': 'No active "{0}" reminders found.',

  // ── Cron push ──
  'cron.mileage': '🔔 Maintenance Reminder{0}\nTime to handle "{1}": current {2} ≥ trigger {3} km{4}',
  'cron.date': '🔔 Reminder{0}\n{1} is due: {2}',
  'cron.renewed': '\nAuto-renewed — next reminder at {0} km',

  // ── Entry ──
  'welcome.title': '👋 Moto Fuel Agent',
  'welcome.body': '\n\nSend a message to log fuel or query stats. Examples:\n• Just filled 10L of 95, ¥98, odometer 12580\n• Check fuel consumption for last 3 months\n• When was my last fill-up?\n\nCommands: /stats monthly  /last recent  /help',
  'help.title': '📖 Help',
  'help.body': '\n\nLog fuel: Just describe your fill-up\n  "10 liters, ¥98, odometer 12580"\n\nQuery stats:\n  "Last 3 months"  "This month"  "Last 5"\n\nCommands:\n  /stats  Monthly stats\n  /last   Last fill-up',
  'voice.too_long': 'Voice message too long ({0}s). Please keep it under {1}s, or type.',
  'voice.stt_failed': 'Speech recognition failed. Please try again or type.',
  'voice.heard': '🎙 Heard: {0}',
  'dashboard.no_url': '⚠️ Dashboard URL not configured. Contact admin to set DASHBOARD_URL.',
  'dashboard.link': '📊 <a href="{0}">Open Moto Agent Dashboard</a>',
  'lang.switched': '✅ Language switched to {0}.',
  'lang.unknown': 'Supported languages: zh (中文), en (English). E.g. /lang en',

  // ── Shortcut commands ──
  'shortcut.last': 'Get the most recent fuel record',
  'shortcut.stats': 'Query this month\'s fuel statistics',

  // ── Knowledge base RAG (spec 015) ──
  'knowledge.empty_query': 'Please enter a search query.',
  'knowledge.embed_failed': 'Knowledge search failed (embedding error), please try again.',
  'knowledge.search_failed': 'Knowledge search failed (search error), please try again.',
  'knowledge.no_results': '📖 No relevant information found in the knowledge base. Consider consulting a professional service shop.',

  // ── Dedup & Delete (spec 017) ──
  'dup.fuel_warn': '⚠️ Possible duplicate fuel record\nThere is already a record on {0} at {1} km, only {3} km from this {2} km.\nRecord anyway? Reply "confirm" to continue.',
  'dup.maint_warn': '⚠️ Possible duplicate maintenance record\nThere is already a "{0}" record around {1}.\nRecord anyway? Reply "confirm" to continue.',
  'delete.recover_hint': '(Contact admin to recover)',
  'delete.fuel_confirm': '⚠️ Delete this fuel record{0}?\n{1}\nReply "confirm" to continue.',
  'delete.fuel_done': '🗑 Deleted fuel record{0}',
  'delete.fuel_not_found': 'No matching fuel record found (specify date or odometer).',
  'delete.fuel_multi': 'Found multiple matching fuel records. Please specify which to delete:\n{0}',
  'delete.maint_confirm': '⚠️ Delete this maintenance record{0}?\n{1}\nReply "confirm" to continue.',
  'delete.maint_done': '🗑 Deleted maintenance record{0}',
  'delete.maint_not_found': 'No matching maintenance record found.',
  'delete.maint_multi': 'Found multiple matching maintenance records. Specify which one, or say "keep only one" to remove duplicates:\n{0}',
  'delete.maint_keep_one_confirm': '⚠️ Found {0} duplicate maintenance records{1}. Keeping the earliest, deleting the other {2}:\n{3}\nReply "confirm" to continue.',
  'delete.maint_kept_one': '🗑 Deleted {0} duplicate maintenance records{1}, kept the earliest.',

  // ── Units ──
  'unit.km': 'km',
  'unit.l': 'L',
  'unit.l_per_100km': 'L/100km',
  'unit.yuan_per_l': '{0}/L',
};
