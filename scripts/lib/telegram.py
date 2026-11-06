"""telegram.py — one-way alerts for the site (✅ published, ⚠️ failures/credit/catch-up).
Reuses the Reels app's own Telegram code and its «مجموعة التنبيهات» group, exactly like the Claude Code hook
(C:/Reels/engine/tools/notify_telegram.py). The token and chat id are read at run time by that code; nothing is printed or copied.
  python -X utf8 scripts/lib/telegram.py "message text"      exit 0 = sent, 1 = not sent (reason on stderr, secrets masked)
  SITE_TELEGRAM_FAKE=<file>  write the message to a file instead of sending (tests)
In GitHub Actions (no Reels app there) it sends with TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID from the repo secrets."""
import json, os, re, sys, urllib.parse, urllib.request

ENGINE = os.environ.get("REELS_ENGINE") or "C:/Reels/engine"


def main():
    text = " ".join(sys.argv[1:]).strip()
    if not text:
        print("no message", file=sys.stderr)
        return 1
    fake = os.environ.get("SITE_TELEGRAM_FAKE")
    if fake:
        with open(fake, "a", encoding="utf-8") as f:
            f.write(text + "\n---\n")
        return 0
    secrets = []
    tok, chat = os.environ.get("TELEGRAM_BOT_TOKEN"), os.environ.get("TELEGRAM_CHAT_ID")
    if tok and chat:  # cloud
        try:
            data = urllib.parse.urlencode({"chat_id": chat, "text": text[:4000], "disable_web_page_preview": "true"}).encode()
            with urllib.request.urlopen(f"https://api.telegram.org/bot{tok}/sendMessage", data, timeout=20) as r:
                if not json.load(r).get("ok"):
                    raise RuntimeError("telegram replied not ok")
            return 0
        except Exception as e:
            print("telegram not sent: " + str(e).replace(tok, "[secret]").replace(chat, "[secret]"), file=sys.stderr)
            return 1
    try:
        sys.path.insert(0, os.path.join(ENGINE, "review"))
        devnull, sys.stdout = sys.stdout, open(os.devnull, "w")  # the app's code may print Telegram's replies
        try:
            import notify
            secrets.extend(notify.secret_values())
            d = notify.role_dest("notify")
            if not d or not d.get("chat_id"):
                raise RuntimeError("no «مجموعة التنبيهات» in the Reels app settings")
            secrets.append(str(d["chat_id"]))
            notify.send(d["id"], text)
        finally:
            sys.stdout = devnull
        return 0
    except Exception as e:  # never show a secret, whatever the error says
        msg = str(e)
        for s in secrets:
            if s:
                msg = msg.replace(str(s), "[secret]")
        msg = re.sub(r"\d{5,15}:[A-Za-z0-9_-]{20,}", "[secret]", msg)
        print(f"telegram not sent: {msg}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
