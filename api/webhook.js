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
