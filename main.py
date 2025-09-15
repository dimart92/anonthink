import os, asyncio, logging
from aiogram import Bot, Dispatcher, types
from aiogram.utils.executor import start_webhook

TOKEN   = os.environ["8356896546:AAFvXuH97dQi6xKOQoWzbPyzU4xSdRCydZ4"]
CHANNEL = int(os.environ["-1002909199388"])

WEBHOOK_PATH = f'/webhook/{TOKEN}'
WEBHOOK_URL  = os.environ["https://anonthink.vercel.app/"] + WEBHOOK_PATH

bot = Bot(token=8356896546:AAFvXuH97dQi6xKOQoWzbPyzU4xSdRCydZ4, parse_mode="HTML")
dp  = Dispatcher(bot)
logging.basicConfig(level=logging.INFO)

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
        else:
            await m.reply("Формат не поддерживается.")
            return
        await bot.send_chat_action(m.chat.id, "typing")  # просто «галочка»
    except Exception as e:
        logging.exception(e)
        await m.reply("Не удалось опубликовать.")

async def on_startup(dp):
    await bot.set_webhook(WEBHOOK_URL)

async def on_shutdown(dp):
    await bot.delete_webhook()

# Vercel запустит эту функцию
from vercel_python import handler
handler = start_webhook(dp, webhook_path=WEBHOOK_PATH,
                        on_startup=on_startup, on_shutdown=on_shutdown)
