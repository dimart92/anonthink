import os, asyncio, logging
from aiogram import Bot, Dispatcher, types
from aiogram.types import InputMediaPhoto, InputMediaVideo, InputMediaDocument
from aiogram.utils.executor import start_webhook

TOKEN   = os.getenv("TELEGRAM_TOKEN")
CHANNEL = int(os.getenv("CHANNEL_ID"))
WEBHOOK_PATH = f'/webhook/{TOKEN}'
WEBHOOK_URL  = os.getenv("VERCEL_URL") + WEBHOOK_PATH

bot = Bot(token=TOKEN, parse_mode="HTML")
dp  = Dispatcher(bot)
logging.basicConfig(level=getattr(logging, os.getenv("LOG_LEVEL","ERROR")))

@dp.message_handler(commands=["start","help"])
async def welcome(m: types.Message):
    await m.answer("Отправь мне любое сообщение, и я анонимно опубликую его в канале.")

@dp.message_handler(content_types=types.ContentTypes.ANY)
async def forward(m: types.Message):
    try:
        if m.text:
            await bot.send_message(CHANNEL, m.html_text)
        elif m.photo:
            await bot.send_photo(CHANNEL, m.photo[-1].file_id, caption=m.html_text if m.caption else None)
        elif m.video:
            await bot.send_video(CHANNEL, m.video.file_id, caption=m.html_text if m.caption else None)
        elif m.document:
            await bot.send_document(CHANNEL, m.document.file_id, caption=m.html_text if m.caption else None)
        elif m.voice:
            await bot.send_voice(CHANNEL, m.voice.file_id)
        else:
            await m.reply("Формат не поддерживается.")
            return
        await m.react("👍")   # aiogram 3.x: use answer with emoji
    except Exception as e:
        logging.exception(e)
        await m.react("👎")

async def on_startup(dp):
    await bot.set_webhook(WEBHOOK_URL)

async def on_shutdown(dp):
    await bot.delete_webhook()

# Vercel вызывает handler
from vercel import handler   # pip install vercel-python
handler = start_webhook(dp, webhook_path=WEBHOOK_PATH,
                        on_startup=on_startup, on_shutdown=on_shutdown)