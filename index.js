const { Telegraf } = require('telegraf');

const bot = new Telegraf(process.env.TELEGRAM_TOKEN);
const channelId = process.env.CHANNEL_ID;   // строка "-100..."

bot.start(ctx => ctx.reply('Отправь мне anything → опубликую анонимно.'));
bot.on('text', ctx => ctx.telegram.sendMessage(channelId, ctx.message.text));
bot.on('photo', ctx => ctx.telegram.sendPhoto(channelId, ctx.message.photo.at(-1).file_id,
                                            { caption: ctx.message.caption || '' }));
bot.on('video', ctx => ctx.telegram.sendVideo(channelId, ctx.message.video.file_id,
                                            { caption: ctx.message.caption || '' }));
bot.on('document', ctx => ctx.telegram.sendDocument(channelId, ctx.message.document.file_id,
                                                   { caption: ctx.message.caption || '' }));

// Vercel serverless-entrypoint
module.exports = bot.webhookCallback(`/webhook/${process.env.TELEGRAM_TOKEN}`);
