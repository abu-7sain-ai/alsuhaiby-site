// night-summary.js — the short Arabic summary shown at the end of the desktop shortcut «تجهيز الصهيبي» (scripts/night.bat).
// Reads data/run-night.json, which night.js updates after every video (so it is right even after a crash or a closed window).
import path from 'node:path';
import { ROOT, readJson } from './lib/common.js';

const p = readJson(path.join(ROOT, 'data', 'run-night.json'), null);
const line = '═'.repeat(44);
const out = [];
if (!p) {
  out.push('ما لقيت نتيجة تشغيل. يمكن التشغيل ما بدأ أصلًا — شوف الرسالة فوق.');
} else {
  const kw = (iso) => new Date(Date.parse(iso) + 3 * 3600e3).toISOString().slice(11, 16);
  const h = Math.floor(p.minutes / 60), m = p.minutes % 60;
  const why = {
    'claude-limit': 'وقف لأن حد اشتراك Claude انتهى لهالفترة.\n   الشغل كله محفوظ. شغّل الأيقونة مرة ثانية بعد ما يتجدد الحد (عادة خلال ساعات).',
    tiktok: 'وقف لأن تيك توك منع التحميل مؤقتًا من الجهاز.\n   الشغل محفوظ. شغّله مرة ثانية بعد ساعة أو ساعتين.',
    errors: '3 فيديوهات فشلت ورا بعض — في شي خربان (الإنترنت أو مفتاح).\n   الشغل محفوظ. شيّك الإنترنت وشغّله مرة ثانية؛ لو تكرر قول لكلود.',
  }[p.stopped];
  out.push(
    line, '   تجهيز الصهيبي — الملخص', line,
    `البداية ${kw(p.startedAt)}  ·  آخر تحديث ${kw(p.updatedAt)}  ·  المدة ${h} ساعة و ${m} دقيقة`,
    '',
    `فيديوهات انعملت: ${p.processed}   (بالساعة: ${p.perHour})`,
    `   مقالات جديدة دخلت الطابور: ${p.written}`,
    `   انضافت لصفحات موجودة: ${p.merged}`,
    `   متخطّاة (مو موضوع مقال): ${p.skipped}`,
    `   فشلت: ${p.failed}`,
    '',
    `باقي من الأرشيف: ${p.archiveLeft} من 683`,
    `بالطابور ينتظر النشر: ${p.queueWaiting}`,
    '',
    p.running ? 'التشغيل انقطع قبل ما يخلص (الشباك تسكّر أو الجهاز طفى). ما ضاع شي — شغّله مرة ثانية ويكمل.'
      : why || (p.archiveLeft === 0 ? 'خلص الأرشيف كله. 🎉' : 'خلص التشغيل بدون مشاكل.'),
  );
  const fails = p.details?.failed || [];
  if (fails.length) out.push('', 'الأخطاء:', ...fails.slice(0, 5).map((f) => `   - ${f}`));
}
out.push('', 'اضغط أي زر عشان تسكّر الشباك.');
console.log(out.join('\n'));
