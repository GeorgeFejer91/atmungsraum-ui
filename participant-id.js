export function participantIdentity({ surnamePrefix = '', age = '', gender = '' } = {}) {
  if (typeof surnamePrefix !== 'string' || !['string', 'number'].includes(typeof age)) throw new Error('Invalid participant');
  let name = surnamePrefix.trim().normalize('NFC');
  if (!/^\p{L}{3}$/u.test(name)) throw new Error('Enter three surname letters');
  const lower = name.toLocaleLowerCase('de-DE');
  const styled = lower[0].toLocaleUpperCase('de-DE') + lower.slice(1);
  if (/^\p{L}{3}$/u.test(styled)) name = styled;
  const years = String(age).trim() === '' ? NaN : Number(age);
  const genders = { male: 'M', female: 'F', other: 'O', 'prefer-not-to-say': 'N' };
  const genderCode = Object.hasOwn(genders, gender) ? genders[gender] : null;
  if (!Number.isSafeInteger(years) || years < 0 || !genderCode) throw new Error('Invalid age or gender');
  return { name, age: years, genderCode, id: `${name}_${years}_${genderCode}` };
}
