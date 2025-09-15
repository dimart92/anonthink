// api/webhook.js
const { Telegraf, Markup } = require('telegraf');

const bot   = new Telegraf(process.env.TELEGRAM_TOKEN);
const channelId = process.env.CHANNEL_ID;
const adminId   = Number(process.env.ADMIN_ID);

/* ---------- хранилища ---------- */
const pending   = new Map(); // userMsgId → {type, fileId, caption}
const cooldown  = new Map(); // userId → timestamp
const banned    = new Set(); // Set<number>  (persist через env не делаем для краткости)
const stats     = { total: 0, published: 0, rejected: 0 };

/* ---------- helpers ---------- */
const RATE_LIMIT_MS = 5000; // 5 секунд

function isAdmin(id) { return id === adminId; }

function isCool(id) {
  const now = Date.now();
  const last = cooldown.get(id);
  if (last && now - last < RATE_LIMIT_MS) return false;
  cooldown.set(id, now);
  return true;
}

/* ---------- старт ---------- */
bot.start(ctx => ctx.reply('Привет! Напиши что на душе'));

/* ---------- rate-limit + ban ---------- */
bot.use((ctx, next) => {
  if (!ctx.message) return next(); // только сообщения
  if (banned.has(ctx.from.id)) return; // тихо игнорим
  if (!isCool(ctx.from.id)) {
    return ctx.reply('⏎ Подождите 5 секунд перед следующим сообщением.');
  }
  return next();
});

/* ---------- приём контента ---------- */
async function forwardToAdmin(type, fileId, caption, userMsgId, userId) {
  const key = `${userMsgId}_${userId}`;
  const kb = Markup.inlineKeyboard([
    [Markup.button.callback('✅ Принять', `pub_${key}`),
     Markup.button.callback('❌ Отклонить', `rej_${key}`)]
  ]);

  const header = `Новая мысль #id${key}:\n\n`;
  if (type === 'text') {
    await bot.telegram.sendMessage(adminId, header + caption, kb);
  } else if (type === 'photo') {
    await bot.telegram.sendPhoto(adminId, fileId, {caption: header + caption, ...kb});
  } else if (type === 'video') {
    await bot.telegram.sendVideo(adminId, fileId, {caption: header + caption, ...kb});
  } else if (type === 'document') {
    await bot.telegram.sendDocument(adminId, fileId, {caption: header + caption, ...kb});
  }
  pending.set(key, {type, fileId, caption});
}

bot.on('text', async ctx => {
  const txt = ctx.message.text;
  await ctx.reply('Спасибо, что поделился! В скором времени твоя мысль появится на канале');
  await forwardToAdmin('text', null, txt, ctx.message.message_id, ctx.from.id);
});

bot.on('photo', async ctx => {
  const fileId = ctx.message.photo.at(-1).file_id;
  const cap = ctx.message.caption || '';
  await ctx.reply('Спасибо, что поделился! В скором времени твоя мысль появится на канале.');
  await forwardToAdmin('photo', fileId, cap, ctx.message.message_id, ctx.from.id);
});

bot.on('video', async ctx => {
  const fileId = ctx.message.video.file_id;
  const cap = ctx.message.caption || '';
  await ctx.reply('Спасибо, что поделился! В скором времени твоя мысль появится на канале.');
  await forwardToAdmin('video', fileId, cap, ctx.message.message_id, ctx.from.id);
});

bot.on('document', async ctx => {
  const fileId = ctx.message.document.file_id;
  const cap = ctx.message.caption || '';
  await ctx.reply('Спасибо, что поделился! В скором времени твоя мысль появится на канале.');
  await forwardToAdmin('document', fileId, cap, ctx.message.message_id, ctx.from.id);
});

/* ---------- админские кнопки ---------- */
bot.action(/^pub_(.+)/, async ctx => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery('Нет прав');
  const p = pending.get(ctx.match[1]);
  if (!p) return ctx.answerCbQuery('Устарело');

  try {
    if (p.type === 'text')        await bot.telegram.sendMessage(channelId, p.caption);
    else if (p.type === 'photo')  await bot.telegram.sendPhoto(channelId, p.fileId, {caption: p.caption});
    else if (p.type === 'video')  await bot.telegram.sendVideo(channelId, p.fileId, {caption: p.caption});
    else if (p.type === 'document') await bot.telegram.sendDocument(channelId, p.fileId, {caption: p.caption});
    stats.published++;
  } catch (e) {
    console.error(e);
    return ctx.answerCbQuery('Ошибка публикации');
  }

  pending.delete(ctx.match[1]);
  stats.total++;
  await ctx.answerCbQuery('✅ Опубликовано');
  await ctx.editMessageReplyMarkup({inline_keyboard: []});
});

bot.action(/^rej_(.+)/, async ctx => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery('Нет прав');
  pending.delete(ctx.match[1]);
  stats.rejected++;
  await ctx.answerCbQuery('❌ Отклонено');
  await ctx.editMessageReplyMarkup({inline_keyboard: []});
});

/* ---------- команды админа ---------- */
bot.command('stats', ctx => {
  if (!isAdmin(ctx.from.id)) return;
  ctx.reply(
    `📊 Статистика бота:\n` +
    `Всего обработано: ${stats.total + stats.published + stats.rejected}\n` +
    `Опубликовано: ${stats.published}\n` +
    `Отклонено: ${stats.rejected}\n` +
    `В бане: ${banned.size} чел.`
  );
});

bot.command('ban', async ctx => {
  if (!isAdmin(ctx.from.id)) return;
  const tgt = ctx.message.reply_to_message?.from?.id;
  if (!tgt) return ctx.reply('Ответьте на сообщение нарушителя.');
  banned.add(tgt);
  ctx.reply('🚫 Пользователь забанен.');
});

bot.command('unban', async ctx => {
  if (!isAdmin(ctx.from.id)) return;
  const tgt = ctx.message.reply_to_message?.from?.id;
  if (!tgt) return ctx.reply('Ответьте на сообщение.');
  banned.delete(tgt);
  ctx.reply('✅ Пользователь разбанен.');
});

/* ---------- serverless entry ---------- */
module.exports = (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');
  return bot.webhookCallback(`/webhook/${process.env.TELEGRAM_TOKEN}`)(req, res);
};
