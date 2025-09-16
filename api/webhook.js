// api/webhook.js – голос через Kimi, без openai
const { Telegraf, Markup } = require('telegraf');

const bot   = new Telegraf(process.env.TELEGRAM_TOKEN);
const channelId = process.env.CHANNEL_ID;
const adminId   = Number(process.env.ADMIN_ID);
const kimiAuth  = process.env.KIMI_AUTH; // Bearer <jwt>

/* ---------- хранилища ---------- */
const pending   = new Map();
const cooldown  = new Map();
const banned    = new Set();
const stats     = { total: 0, published: 0, rejected: 0 };

const RATE_LIMIT_MS = 5000;
const isAdmin = (id) => id === adminId;
const isCool = (id) => {
  const now = Date.now();
  const last = cooldown.get(id);
  if (last && now - last < RATE_LIMIT_MS) return false;
  cooldown.set(id, now);
  return true;
};

/* ---------- Kimi Whisper (НОВОЕ) ---------- */
async function stt(fileLink) {
  try {
    const voiceResp = await fetch(fileLink);
    const blob = await voiceResp.blob();

    const preRes = await fetch('https://www.kimi.com/api/pre-sign-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': kimiAuth },
      body: JSON.stringify({ name: 'voice.ogg', action: 'file' })
    });
    const { url, object_name } = await preRes.json();

    await fetch(url, { method: 'PUT', body: blob, headers: { 'Content-Type': 'audio/ogg' } });

    const fileRes = await fetch('https://www.kimi.com/api/file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': kimiAuth },
      body: JSON.stringify({ name: 'voice.ogg', object_name, type: 'file' })
    });
    const { id: fileId } = await fileRes.json();

    await fetch('https://www.kimi.com/api/file/parse_process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': kimiAuth },
      body: JSON.stringify({ ids: [fileId] })
    });

    let text = '';
    for (let i = 0; i < 20; i++) {
      const check = await fetch(`https://www.kimi.com/api/file/${fileId}`, {
        headers: { 'Authorization': kimiAuth }
      });
      const info = await check.json();
      if (info.status === 'parsed') {
        text = info.parsed_content || '<пусто>';
        break;
      }
      await new Promise(r => setTimeout(r, 1000));
    }
    return text || '<не распознано>';
  } catch (e) {
    console.error('Kimi STT error:', e);
    return '<ошибка распознавания>';
  }
}

/* ---------- приём контента ---------- */
bot.start(ctx => ctx.reply('Присылай мысль – текст, фото, видео или голос!'));

bot.use((ctx, next) => {
  if (!ctx.message) return next();
  if (banned.has(ctx.from.id)) return;
  if (!isCool(ctx.from.id)) return ctx.reply('⏎ Подождите 5 сек.');
  return next();
});

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
    await bot.telegram.sendVoice(adminId, fileId);
  }
  pending.set(key, {type, fileId, caption, voiceText});
}

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

bot.on('voice', async ctx => {
  const fileId = ctx.message.voice.file_id;
  const cap = ctx.message.caption || '';
  await ctx.reply('🎙 Расшифровываю голос...');
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

bot.action(/^edit_(.+)/, async ctx => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery('Нет прав');
  const p = pending.get(ctx.match[1]);
  if (!p) return ctx.answerCbQuery('Устарело');
  bot.ctx = bot.ctx || {};
  bot.ctx.awaitEdit = { key: ctx.match[1], chatId: ctx.chat.id, msgId: ctx.callbackQuery.message.message_id };
  ctx.answerCbQuery('Отправьте исправленный текст одним сообщением.');
});

bot.on('text', async ctx => {
  const ae = bot.ctx?.awaitEdit;
  if (ae && ctx.chat.id === adminId) {
    const p = pending.get(ae.key);
    if (!p) return;
    p.voiceText = ctx.message.text;
    await bot.telegram.editMessageText(ae.chatId, ae.msgId, null,
      `✏️ Исправлено:\n\n${ctx.message.text}`, Markup.inlineKeyboard([
        [Markup.button.callback('✅ Принять', `pub_${ae.key}`),
         Markup.button.callback('❌ Отклонить', `rej_${ae.key}`)]
      ]));
    delete bot.ctx.awaitEdit;
    return;
  }
  const txt = ctx.message.text;
  await ctx.reply('Спасибо, что поделился! В скором времени твоя мысль появится на канале.');
  await forwardToAdmin('text', null, txt, ctx.message.message_id, ctx.from.id);
});

bot.command('stats', ctx => {
  if (!isAdmin(ctx.from.id)) return;
  ctx.reply(`📊 Статистика:\nОпубликовано: ${stats.published}\nОтклонено: ${stats.rejected}\nВ бане: ${banned.size}`);
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
