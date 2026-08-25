import PlanConfig from "../models/PlanConfig.js";

export async function computeAttendanceStatus(attendanceType, attendanceTime) {
  const config = (await PlanConfig.findOne()) || { workStartTime: "10:00", workEndTime: "17:00" };

  const time = new Date(attendanceTime);
  const minutesSinceMidnight = time.getHours() * 60 + time.getMinutes();

  const [startH, startM] = config.workStartTime.split(":").map(Number);
  const [endH, endM] = config.workEndTime.split(":").map(Number);
  const workStartMinutes = startH * 60 + startM;
  const workEndMinutes = endH * 60 + endM;

  if (attendanceType === "checkin" && minutesSinceMidnight > workStartMinutes) {
    return "late_checkin";
  }
  if (attendanceType === "checkout" && minutesSinceMidnight < workEndMinutes) {
    return "early_checkout";
  }
  return "ontime";
}
