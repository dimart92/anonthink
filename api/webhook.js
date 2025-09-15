const { Telegraf, Markup } = require('telegraf');

const bot   = new Telegraf(process.env.TELEGRAM_TOKEN);
const channelId = process.env.CHANNEL_ID;
const adminId   = Number(process.env.ADMIN_ID);

// временное хранилище:  userMsgId → {type, fileId, caption}
const pending = new Map();

/* ---------- команды пользователя ---------- */
bot.start(ctx =>
  ctx.reply('Привет! Напиши что на душе')
);

bot.on('text', async ctx => {
  const userText = ctx.message.text;
  const userId   = ctx.message.from.id;

  // 1. Отвечаем пользователю
  await ctx.reply('Спасибо, что поделился! В скором времени твоя мысль появится на канале');

  // 2. Шлём админу
  const kb = Markup.inlineKeyboard([
    [Markup.button.callback('✅ Принять', `pub_${ctx.message.message_id}_${userId}`),
     Markup.button.callback('❌ Отклонить', `rej_${ctx.message.message_id}_${userId}`)]
  ]);
  await bot.telegram.sendMessage(adminId, `Новая мысль:\n\n${userText}`, kb);

  // 3. Сохраняем
  pending.set(`${ctx.message.message_id}_${userId}`, {type: 'text', fileId: null, caption: userText});
});

bot.on('photo', async ctx => {
  const fileId = ctx.message.photo.at(-1).file_id;
  const cap    = ctx.message.caption || '';
  const userId = ctx.message.from.id;

  await ctx.reply('Спасибо, что поделился! В скором времени твоя мысль появится на канале.');

  const kb = Markup.inlineKeyboard([
    [Markup.button.callback('✅ Принять', `pub_${ctx.message.message_id}_${userId}`),
     Markup.button.callback('❌ Отклонить', `rej_${ctx.message.message_id}_${userId}`)]
  ]);
  await bot.telegram.sendPhoto(adminId, fileId, {caption: `Новая мысль:\n\n${cap}`, ...kb});

  pending.set(`${ctx.message.message_id}_${userId}`, {type: 'photo', fileId, caption: cap});
});

// то же для видео и документов (копируйте логику photo, меняйте type и sendVideo/sendDocument)

/* ---------- админские кнопки ---------- */
bot.action(/^pub_(.+)_(\d+)/, async ctx => {
  const key = `${ctx.match[1]}_${ctx.match[2]}`;
  const p   = pending.get(key);
  if (!p) return ctx.answerCbQuery('Устарело');

  try {
    if (p.type === 'text')        await bot.telegram.sendMessage(channelId, p.caption);
    else if (p.type === 'photo')  await bot.telegram.sendPhoto(channelId, p.fileId, {caption: p.caption});
    // else if (p.type === 'video') await bot.telegram.sendVideo(channelId, p.fileId, {caption: p.caption});
    // else if (p.type === 'doc')   await bot.telegram.sendDocument(channelId, p.fileId, {caption: p.caption});
  } catch (e) {
    console.error(e);
    return ctx.answerCbQuery('Ошибка публикации');
  }

  pending.delete(key);
  await ctx.answerCbQuery('✅ Опубликовано');
  await ctx.editMessageReplyMarkup({inline_keyboard: []});
});

bot.action(/^rej_(.+)_(\d+)/, async ctx => {
  const key = `${ctx.match[1]}_${ctx.match[2]}`;
  pending.delete(key);
  await ctx.answerCbQuery('❌ Отклонено');
  await ctx.editMessageReplyMarkup({inline_keyboard: []});
});

/* ---------- вход для Vercel ---------- */
module.exports = (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');
  return bot.webhookCallback(`/webhook/${process.env.TELEGRAM_TOKEN}`)(req, res);
};
