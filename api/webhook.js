const { Telegraf, Markup } = require('telegraf');
const OpenAI = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const bot   = new Telegraf(process.env.TELEGRAM_TOKEN);
const channelId = process.env.CHANNEL_ID;
const adminId   = Number(process.env.ADMIN_ID);

/* ---------- хранилища ---------- */
const pending   = new Map(); // key → {type, fileId, caption, voiceText?}
const cooldown  = new Map(); // userId → timestamp
const banned    = new Set();
const stats     = { total: 0, published: 0, rejected: 0 };

/* ---------- helpers ---------- */
const RATE_LIMIT_MS = 5000;

function isAdmin(id) { return id === adminId; }
function isCool(id) {
  const now = Date.now();
  const last = cooldown.get(id);
  if (last && now - last < RATE_LIMIT_MS) return false;
  cooldown.set(id, now);
  return true;
}

/* ---------- старт ---------- */
bot.start(ctx => ctx.reply('Присылай мысль – текст, фото, видео или голос!'));

/* ---------- rate-limit + ban ---------- */
bot.use((ctx, next) => {
  if (!ctx.message) return next();
  if (banned.has(ctx.from.id)) return;
  if (!isCool(ctx.from.id)) {
    return ctx.reply('⏎ Подождите 5 секунд.');
  }
  return next();
});

/* ---------- распознавание голоса ---------- */
async function stt(fileLink) {
  try {
    const resp = await openai.audio.transcriptions.create({
      file: fileLink,
      model: 'whisper-1',
      language: 'ru'
    });
    return resp.text.trim();
  } catch (e) {
    console.error('Whisper error:', e);
    return '<ошибка распознавания>';
  }
}

/* ---------- forward to admin (универсально) ---------- */
async function forwardToAdmin(type, fileId, caption, userMsgId, userId, voiceText = null) {
  const key = `${userMsgId}_${userId}`;
  const kb = Markup.inlineKeyboard([
    [Markup.button.callback('✅ Принять', `pub_${key}`),
     Markup.button.callback('❌ Отклонить', `rej_${key}`),
     Markup.button.callback('✏️ Править', `edit_${key}`)]
  ]);

  let header = `Новая мысль #id${key}:\n\n`;
  if (voiceText) header += `🎙 Расшифровка: ${voiceText}\n\n`;
  if (caption) header += `Подпись: ${caption}\n\n`;

  if (type === 'text') {
    await bot.telegram.sendMessage(adminId, header, kb);
  } else if (type === 'photo') {
    await bot.telegram.sendPhoto(adminId, fileId, {caption: header, ...kb});
  } else if (type === 'video') {
    await bot.telegram.sendVideo(adminId, fileId, {caption: header, ...kb});
  } else if (type === 'document') {
    await bot.telegram.sendDocument(adminId, fileId, {caption: header, ...kb});
  } else if (type === 'voice') {
    await bot.telegram.sendMessage(adminId, header + '(голосовое ниже)', kb);
    await bot.telegram.sendVoice(adminId, fileId); // пришлём оригинал ниже текста
  }

  pending.set(key, {type, fileId, caption, voiceText});
}

/* ---------- приём контента ---------- */
bot.on('text', async ctx => {
  const txt = ctx.message.text;
  await ctx.reply('Спасибо, что поделился! В скором времени твоя мысль появится на канале.');
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

/* ---------- голосовые ---------- */
bot.on('voice', async ctx => {
  const fileId = ctx.message.voice.file_id;
  const cap = ctx.message.caption || '';

  await ctx.reply('🎙 Расшифровываю голос...');

  // скачиваем файл
  const fileLink = await bot.telegram.getFileLink(fileId);
  const voiceText = await stt(fileLink.href);

  await ctx.reply('Спасибо, что поделился! В скором времени твоя мысль появится на канале.');
  await forwardToAdmin('voice', fileId, cap, ctx.message.message_id, ctx.from.id, voiceText);
});

/* ---------- админские кнопки ---------- */
bot.action(/^pub_(.+)/, async ctx => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery('Нет прав');
  const p = pending.get(ctx.match[1]);
  if (!p) return ctx.answerCbQuery('Устарело');

  try {
    if (p.type === 'text')        await bot.telegram.sendMessage(channelId, p.voiceText || p.caption);
    else if (p.type === 'photo')  await bot.telegram.sendPhoto(channelId, p.fileId, {caption: p.caption});
    else if (p.type === 'video')  await bot.telegram.sendVideo(channelId, p.fileId, {caption: p.caption});
    else if (p.type === 'document') await bot.telegram.sendDocument(channelId, p.fileId, {caption: p.caption});
    else if (p.type === 'voice')  await bot.telegram.sendMessage(channelId, p.voiceText);
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

/* ---------- правка текста ---------- */
bot.action(/^edit_(.+)/, async ctx => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery('Нет прав');
  const p = pending.get(ctx.match[1]);
  if (!p) return ctx.answerCbQuery('Устарело');

  // просим прислать новый текст
  ctx.answerCbQuery('Отправьте исправленный текст одним сообщением.');
  // ставим флаг: ожидаем правку от админа
  bot.ctx = bot.ctx || {};
  bot.ctx.awaitEdit = { key: ctx.match[1], chatId: ctx.chat.id, msgId: ctx.callbackQuery.message.message_id };
});

bot.on('text', async ctx => {
  // если админ прислал правку – перезаписываем
  const ae = bot.ctx?.awaitEdit;
  if (ae && ctx.chat.id === adminId) {
    const p = pending.get(ae.key);
    if (!p) return; // устарело
    p.voiceText = ctx.message.text; // перезаписываем текст
    // обновляем сообщение админу
    await bot.telegram.editMessageText(ae.chatId, ae.msgId, null,
      `✏️ Исправлено:\n\n${ctx.message.text}`, Markup.inlineKeyboard([
        [Markup.button.callback('✅ Принять', `pub_${ae.key}`),
         Markup.button.callback('❌ Отклонить', `rej_${ae.key}`)]
      ]));
    delete bot.ctx.awaitEdit;
    return;
  }

  // обычный текст пользователя – модерация
  const txt = ctx.message.text;
  await ctx.reply('Спасибо, что поделился! В скором времени твоя мысль появится на канале.');
  await forwardToAdmin('text', null, txt, ctx.message.message_id, ctx.from.id);
});

/* ---------- команды админа ---------- */
bot.command('stats', ctx => {
  if (!isAdmin(ctx.from.id)) return;
  ctx.reply(
    `📊 Статистика:\n` +
    `Опубликовано: ${stats.published}\n` +
    `Отклонено: ${stats.rejected}\n` +
    `В бане: ${banned.size}`
  );
});

bot.command('ban', async ctx => {
  if (!isAdmin(ctx.from.id)) return;
  const tgt = ctx.message.reply_to_message?.from?.id;
  if (!tgt) return ctx.reply('Ответьте на сообщение нарушителя.');
  banned.add(tgt);
  ctx.reply('🚫 Забанен.');
});

bot.command('unban', async ctx => {
  if (!isAdmin(ctx.from.id)) return;
  const tgt = ctx.message.reply_to_message?.from?.id;
  if (!tgt) return ctx.reply('Ответьте на сообщение.');
  banned.delete(tgt);
  ctx.reply('✅ Разбанен.');
});

/* ---------- serverless entry ---------- */
module.exports = (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');
  return bot.webhookCallback(`/webhook/${process.env.TELEGRAM_TOKEN}`)(req, res);
};
