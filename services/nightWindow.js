/**
 * Indian Market Edge Case (TRD Section 3.5):
 * TRAI Compliance & Night-Time Owl Orders (9:30 PM – 8:30 AM IST)
 * Holds calls placed at night and schedules for 9:00 AM IST morning batch.
 */

function getIstTime() {
  const now = new Date();
  // IST is UTC + 5:30
  const utcOffsetMs = now.getTime() + (now.getTimezoneOffset() * 60000);
  const istOffsetMs = 5.5 * 3600000;
  return new Date(utcOffsetMs + istOffsetMs);
}

function checkCallingWindow() {
  const ist = getIstTime();
  const hours = ist.getHours();
  const minutes = ist.getMinutes();
  const timeInMinutes = hours * 60 + minutes;

  // Window: 8:30 AM (510 min) to 9:30 PM (1290 min)
  const windowStartMin = 8 * 60 + 30; // 8:30 AM
  const windowEndMin = 21 * 60 + 30;  // 9:30 PM

  const isAllowedNow = timeInMinutes >= windowStartMin && timeInMinutes <= windowEndMin;

  let scheduledFor = null;
  if (!isAllowedNow) {
    const nextMorning = new Date(ist);
    if (timeInMinutes > windowEndMin) {
      // Past 9:30 PM: Schedule for tomorrow 9:00 AM
      nextMorning.setDate(nextMorning.getDate() + 1);
    }
    nextMorning.setHours(9, 0, 0, 0);
    scheduledFor = nextMorning.toISOString();
  }

  return {
    isAllowedNow,
    scheduledFor,
    istHour: hours,
    istMinute: minutes,
    currentTimeIst: ist.toLocaleTimeString('en-IN', { hour12: true })
  };
}

module.exports = {
  getIstTime,
  checkCallingWindow
};
