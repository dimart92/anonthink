const { Telegraf, Markup } = require('telegraf');
const bot = new Telegraf(process.env.TELEGRAM_TOKEN);
const channelId = process.env.CHANNEL_ID;
const adminId   = Number(process.env.ADMIN_ID);   // ваша цифра

const pending = new Map(); // id → {msg, type, fileId, caption}

bot.start(ctx => ctx.reply('Отправь anything → сначала админу, потом в канал.'));

async function sendToAdmin(type, fileId, caption, fromId) {
  const kb = Markup.inlineKeyboard([
    [Markup.button.callback('✅ Опубликовать',   `pub_${fromId}`),
     Markup.button.callback('❌ Отклонить',     `rej_${fromId}`)]
  ]);
  if (type === 'text')        await bot.telegram.sendMessage(adminId, `Текст:\n${caption}`, kb);
  else if (type === 'photo')  await bot.telegram.sendPhoto(adminId, fileId, {caption: `Фото:\n${caption}`, ...kb});
  else if (type === 'video')  await bot.telegram.sendVideo(adminId, fileId, {caption: `Видео:\n${caption}`, ...kb});
  else if (type === 'doc')    await bot.telegram.sendDocument(adminId, fileId, {caption: `Файл:\n${caption}`, ...kb});
}

bot.on('text', ctx => {
  const id = ctx.message.message_id;
  pending.set(id, {type:'text', fileId:null, caption:ctx.message.text});
  sendToAdmin('text', null, ctx.message.text, id);
  ctx.reply('✉️ Отправлено на модерацию.');
});
bot.on('photo', ctx => {
  const id = ctx.message.message_id;
  pending.set(id, {type:'photo', fileId:ctx.message.photo.at(-1).file_id, caption:ctx.message.caption||''});
  sendToAdmin('photo', ctx.message.photo.at(-1).file_id, ctx.message.caption||'', id);
  ctx.reply('✉️ Отправлено на модерацию.');
});
// то же для video, document (копируете логику)

bot.action(/^pub_(.+)/, async ctx => {
  const msgId = Number(ctx.match[1]);
  const p = pending.get(msgId);
  if (!p) return ctx.answerCbQuery('Устарело');
  if (p.type === 'text')        await bot.telegram.sendMessage(channelId, p.caption);
  else if (p.type === 'photo')  await bot.telegram.sendPhoto(channelId, p.fileId, {caption:p.caption});
  else if (p.type === 'video')  await bot.telegram.sendVideo(channelId, p.fileId, {caption:p.caption});
  else if (p.type === 'doc')    await bot.telegram.sendDocument(channelId, p.fileId, {caption:p.caption});
  pending.delete(msgId);
  await ctx.answerCbQuery('✅ Опубликовано');
  await ctx.editMessageReplyMarkup({inline_keyboard:[]});
});
bot.action(/^rej_(.+)/, async ctx => {
  pending.delete(Number(ctx.match[1]));
  await ctx.answerCbQuery('❌ Отклонено');
  await ctx.editMessageReplyMarkup({inline_keyboard:[]});
});

module.exports = (req,res) => {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');
  return bot.webhookCallback(`/webhook/${process.env.TELEGRAM_TOKEN}`)(req,res);
};
let lastMsgId = null;   // message_id последнего поста в канале

// при публикации сохраняем ID
bot.action(/^pub_(.+)/, async ctx => {
  ...публикация...
  const sent = await bot.telegram.sendMessage(channelId, p.caption); // или sendPhoto и т.д.
  lastMsgId = sent.message_id;
  ...
});

bot.command('del', async ctx => {
  if (ctx.from.id !== adminId) return;
  if (!lastMsgId) return ctx.reply('Нет последнего сообщения.');
  try {
    await bot.telegram.deleteMessage(channelId, lastMsgId);
    lastMsgId = null;
    ctx.reply('🗑 Удалено.');
  } catch (e) {
    ctx.reply('Не удалось (старше 48 ч или не существует).');
  }
});
const stats = { total: 0, banned: new Set() };

bot.use((ctx, next) => {
  if (stats.banned.has(ctx.from.id)) return;   // игнорим забаненных
  return next();
});

bot.on('text', ctx => {
  stats.total++;
  ...остальной код...
});

bot.command('stats', ctx => {
  if (ctx.from.id !== adminId) return;
  ctx.reply(`📊 Опубликовано: ${stats.total}\n🚫 В бане: ${stats.banned.size} чел.`);
});

bot.command('ban', ctx => {
  if (ctx.from.id !== adminId) return;
  const tgt = ctx.message.reply_to_message?.from?.id;
  if (!tgt) return ctx.reply('Ответьте на сообщение нарушителя.');
  stats.banned.add(tgt);
  ctx.reply('🚫 Забанен.');
});

bot.command('unban', ctx => {
  if (ctx.from.id !== adminId) return;
  const tgt = ctx.message.reply_to_message?.from?.id;
  if (!tgt) return ctx.reply('Ответьте на сообщение.');
  stats.banned.delete(tgt);
  ctx.reply('✅ Разбанен.');
});
const cooldown = new Map();

function rateLimit(ctx, next) {
  const now = Date.now();
  const uid = ctx.from.id;
  if (cooldown.has(uid) && now - cooldown.get(uid) < 5000)
    return ctx.reply('⏎ Подождите 5 сек.');
  cooldown.set(uid, now);
  return next();
}
bot.use(rateLimit);
