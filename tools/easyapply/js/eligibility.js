// Eligibility check for one Teletalk post, from the page's `postInfo` and the user's profile.
// Mirrors Teletalk's own rules (validator.js isValidDateOfBirth, main.js district filters) so the
// user learns about a problem before paying the application fee. Teletalk still has the final say.

import { hasLevel } from './fields.js?v=1';

const LEVEL_NAME = {
  ssc: { en: 'SSC or equivalent', bn: 'এসএসসি/সমমান' },
  hsc: { en: 'HSC or equivalent', bn: 'এইচএসসি/সমমান' },
  gra: { en: 'Graduation', bn: 'স্নাতক' },
  mas: { en: 'Masters', bn: 'স্নাতকোত্তর' },
  jsc: { en: 'JSC', bn: 'জেএসসি' },
  mph: { en: 'M.Phil', bn: 'এম.ফিল' },
  phd: { en: 'PhD', bn: 'পিএইচডি' },
};

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
export const bnNum = (v) => String(v).replace(/\d/g, (d) => BN_DIGITS[d]);

function parseDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  return m ? { y: +m[1], m: +m[2] - 1, d: +m[3] } : null;
}
const daysInMonth = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

/** Age on `ref` the way Teletalk counts it (birth date minus one day). Returns { y, m, d } or null. */
export function ageOn(dob, ref) {
  const b = parseDate(dob);
  const r = parseDate(ref);
  if (!b || !r) return null;
  const born = new Date(Date.UTC(b.y, b.m, b.d - 1));
  let y = r.y - born.getUTCFullYear();
  let m = r.m - born.getUTCMonth();
  let d = r.d - born.getUTCDate();
  if (d < 0) {
    m -= 1;
    d += daysInMonth(r.y, r.m - 1 < 0 ? 11 : r.m - 1);
  }
  if (m < 0) {
    y -= 1;
    m += 12;
  }
  return { y, m, d };
}

/** Whole days since a YYYY-MM-DD date. */
export function daysSince(dateStr, now = new Date()) {
  const p = parseDate(dateStr);
  if (!p) return null;
  return Math.floor((now.getTime() - Date.UTC(p.y, p.m, p.d)) / 86400000);
}

const list = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean).map((x) => parseInt(x, 10));

function allowedBy(code, allowedCsv, disallowedCsv) {
  const allowed = list(allowedCsv);
  const disallowed = list(disallowedCsv);
  const c = parseInt(code, 10);
  if (!allowed.length && !disallowed.length) return true;
  if (allowed.length && !allowed.includes(c)) return false;
  if (disallowed.includes(c)) return false;
  return true;
}

function totalExperienceYears(jobs, todayStr) {
  let days = 0;
  for (const j of jobs || []) {
    const s = parseDate(j.job_start_date);
    const e = parseDate(j.currently_working === '1' ? todayStr : j.job_end_date);
    if (s && e) days += Math.max(0, (Date.UTC(e.y, e.m, e.d) - Date.UTC(s.y, s.m, s.d)) / 86400000);
  }
  return days / 365.25;
}

/**
 * @param post    the page's `postInfo`
 * @param profile EasyApply profile
 * @param now     current time
 * @param edu     the page's `postEdu` (allowed exams/subjects), optional
 * @param nameOf  (level, 'exam'|'subject', code) => display name, optional
 * @returns {{level:'ok'|'warn'|'bad', en:string, bn:string}[]}
 */
export function checkEligibility(post, profile, now = new Date(), edu = null, nameOf = null) {
  const out = [];
  if (!post || !profile) return out;
  const data = profile.data || {};
  const todayStr = now.toISOString().slice(0, 10);

  // Deadline (Teletalk times are Bangladesh time, UTC+6).
  if (post.app_end_time) {
    const end = new Date(String(post.app_end_time).replace(' ', 'T') + '+06:00');
    const left = end.getTime() - now.getTime();
    if (!isNaN(left)) {
      if (left < 0) out.push({ level: 'bad', en: 'The application deadline has passed.', bn: 'আবেদনের শেষ সময় পার হয়ে গেছে।' });
      else if (left < 48 * 3600 * 1000)
        out.push({ level: 'warn', en: `Deadline: ${post.app_end_time} — less than 2 days left.`, bn: `শেষ সময়: ${bnNum(post.app_end_time)} — ২ দিনেরও কম বাকি।` });
    }
  }

  // Age.
  const ref = post.age_calculate_date;
  const age = data.dob && ref ? ageOn(data.dob, ref) : null;
  if (!data.dob) out.push({ level: 'warn', en: 'Date of birth missing in your profile.', bn: 'প্রোফাইলে জন্ম তারিখ নেই।' });
  else if (age && post.min_age && post.max_age) {
    const min = +post.min_age;
    let max = +post.max_age;
    let relaxed = '';
    if (['1', '2', '3', '4'].includes(String(data.quota)) && post.quota_active == 1 && post.quota_age) {
      max = +post.quota_age;
      relaxed = 'quota';
    }
    if (String(data.dep_status) === '4' && post.dept_active == 1 && post.dept_age && max < +post.dept_age) {
      max = +post.dept_age;
      relaxed = 'dept';
    }
    const ageEn = `${age.y} years ${age.m} months ${age.d} days on ${ref}`;
    const ageBn = `${bnNum(ref)} তারিখে বয়স ${bnNum(age.y)} বছর ${bnNum(age.m)} মাস ${bnNum(age.d)} দিন`;
    const over = age.y > max || (age.y === max && (age.m > 0 || age.d > 0));
    if (age.y < min) out.push({ level: 'bad', en: `Too young: ${ageEn} (minimum ${min}).`, bn: `বয়স কম: ${ageBn} (সর্বনিম্ন ${bnNum(min)})।` });
    else if (over && post.age_calculate_date_covid)
      out.push({ level: 'warn', en: `Over the age limit (${max}) — ${ageEn}. A COVID age relaxation may apply; check the circular.`, bn: `বয়সসীমা (${bnNum(max)}) পেরিয়ে গেছে — ${ageBn}। কোভিড-ছাড় থাকতে পারে, বিজ্ঞপ্তি দেখুন।` });
    else if (over) out.push({ level: 'bad', en: `Over the age limit (${max}): ${ageEn}.`, bn: `বয়সসীমা (${bnNum(max)}) পেরিয়ে গেছে: ${ageBn}।` });
    else
      out.push({
        level: 'ok',
        en: `Age OK: ${ageEn} (limit ${min}–${max}${relaxed ? ', with relaxation' : ''}).`,
        bn: `বয়স ঠিক আছে: ${ageBn} (সীমা ${bnNum(min)}–${bnNum(max)}${relaxed ? ', ছাড়সহ' : ''})।`,
      });
  }

  // Permanent address district / upazila restrictions.
  const same = data.same_as_present === '1';
  const dist = same ? data.present_district : data.permanent_district;
  const upz = same ? data.present_upazila : data.permanent_upazila;
  const distName = (same ? profile.labels?.present_district : profile.labels?.permanent_district) || dist;
  if (dist && (post.allowed_dist_list || post.disallowed_dist_list)) {
    if (!allowedBy(dist, post.allowed_dist_list, post.disallowed_dist_list))
      out.push({ level: 'bad', en: `Your permanent district (${distName}) is not allowed for this post.`, bn: `আপনার স্থায়ী ঠিকানার জেলা (${distName}) এই পদের জন্য অনুমোদিত নয়।` });
    else out.push({ level: 'ok', en: `Permanent district (${distName}) is allowed.`, bn: `স্থায়ী জেলা (${distName}) অনুমোদিত।` });
  }
  if (upz && (post.allowed_upazila_list || post.disallowed_upazila_list) && !allowedBy(upz, post.allowed_upazila_list, post.disallowed_upazila_list))
    out.push({ level: 'bad', en: 'Your permanent upazila is not allowed for this post.', bn: 'আপনার স্থায়ী উপজেলা এই পদের জন্য অনুমোদিত নয়।' });

  // Education levels the post requires.
  for (const lvl of ['ssc', 'hsc', 'gra', 'mas']) {
    if (post[lvl + '_active'] == 1 && post[lvl + '_required'] == 1 && !hasLevel(data, lvl))
      out.push({ level: 'bad', en: `${LEVEL_NAME[lvl].en} is required for this post; your profile has none.`, bn: `এই পদে ${LEVEL_NAME[lvl].bn} আবশ্যক, আপনার প্রোফাইলে নেই।` });
  }
  // Exam types / subjects the post accepts (page variable `postEdu`, e.g. gra_allowed_sub: "120").
  if (edu) {
    for (const lvl of ['ssc', 'hsc', 'gra', 'mas']) {
      if (!hasLevel(data, lvl)) continue;
      const subField = lvl === 'ssc' || lvl === 'hsc' ? `${lvl}_group` : `${lvl}_subject`;
      const checks = [
        [`${lvl}_exam`, edu[`${lvl}_allowed_exam`], 'exam'],
        [subField, edu[`${lvl}_allowed_sub`], 'subject'],
      ];
      for (const [field, csv, kind] of checks) {
        const allowed = list(csv);
        const code = data[field];
        if (!allowed.length || !code || allowed.includes(parseInt(code, 10))) continue;
        const mine = profile.labels?.[field] || code;
        const names = allowed.map((c) => (nameOf && nameOf(lvl, kind, String(c))) || c).join(', ');
        out.push(
          kind === 'exam'
            ? { level: 'bad', en: `${LEVEL_NAME[lvl].en}: “${mine}” is not accepted for this post (accepted: ${names}).`, bn: `${LEVEL_NAME[lvl].bn}: “${mine}” এই পদে গ্রহণযোগ্য নয় (গ্রহণযোগ্য: ${names})।` }
            : { level: 'bad', en: `${LEVEL_NAME[lvl].en} subject “${mine}” is not accepted for this post (accepted: ${names}).`, bn: `${LEVEL_NAME[lvl].bn}-এর বিষয় “${mine}” এই পদে গ্রহণযোগ্য নয় (গ্রহণযোগ্য: ${names})।` },
        );
      }
    }
  }

  for (const lvl of ['jsc', 'mph', 'phd']) {
    if (post[lvl + '_active'] == 1 && post[lvl + '_required'] == 1)
      out.push({ level: 'warn', en: `This post requires ${LEVEL_NAME[lvl].en}; EasyApply does not fill that section yet — fill it yourself.`, bn: `এই পদে ${LEVEL_NAME[lvl].bn} আবশ্যক; EasyApply এই অংশ এখনো পূরণ করে না — নিজে পূরণ করুন।` });
  }

  // Minimum experience.
  const minExp = +post.min_job_exp_year || 0;
  if (minExp > 0) {
    const yrs = totalExperienceYears(profile.jobs, todayStr);
    if (yrs < minExp)
      out.push({ level: 'bad', en: `Needs ${minExp} years of experience; your profile shows about ${yrs.toFixed(1)}.`, bn: `${bnNum(minExp)} বছরের অভিজ্ঞতা লাগবে; আপনার প্রোফাইলে প্রায় ${bnNum(yrs.toFixed(1))} বছর।` });
  }

  out.push(...photoChecks(profile, now));
  return out;
}

/** Photo freshness (Teletalk: photo must be taken within the last month). */
export function photoChecks(profile, now = new Date()) {
  const out = [];
  if (!profile?.photo?.data) out.push({ level: 'warn', en: 'No photo saved in EasyApply yet.', bn: 'EasyApply-তে এখনো ছবি সেভ করা নেই।' });
  else {
    const age = daysSince(profile.photo.takenAt, now);
    if (age != null && age > 30)
      out.push({ level: 'warn', en: `Your photo was taken ${age} days ago. Teletalk wants a photo from the last month — update it in EasyApply.`, bn: `আপনার ছবি ${bnNum(age)} দিন আগের। টেলিটক গত ১ মাসের মধ্যে তোলা ছবি চায় — EasyApply-তে নতুন ছবি দিন।` });
  }
  if (!profile?.signature?.data) out.push({ level: 'warn', en: 'No signature saved in EasyApply yet.', bn: 'EasyApply-তে এখনো স্বাক্ষর সেভ করা নেই।' });
  return out;
}
