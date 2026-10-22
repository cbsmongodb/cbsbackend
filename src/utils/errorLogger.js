import mongoose from "mongoose";
import ErrorLog from "../models/ErrorLog.js";
import { requestStore } from "./requestContext.js";

// Intercepts every console.error(...) across the backend and mirrors it into ErrorLog,
// now with the context: who, which page, which action, and a hint how to fix it.
const originalConsoleError = console.error.bind(console);

// what the person was doing (method + API path -> plain words)
const ACTIONS = [
  [/^POST \/api\/plannings/, "ვიზიტის დაგეგმვა"],
  [/^PUT \/api\/plannings\/[^/]+\/(check-in|i-went)/, "ვიზიტზე ჩექინი"],
  [/^PUT \/api\/plannings\/[^/]+\/(check-out|i-left)/, "ვიზიტიდან ჩექაუთი"],
  [/^(PUT|PATCH) \/api\/plannings/, "ვიზიტის შეცვლა"],
  [/^DELETE \/api\/plannings/, "ვიზიტის წაშლა"],
  [/^GET \/api\/plannings/, "ვიზიტების ჩატვირთვა"],
  [/^POST \/api\/doctor-entry-items/, "რეცეპტების შენახვა"],
  [/^GET \/api\/doctor-entry-items/, "რეცეპტების ჩატვირთვა"],
  [/^POST \/api\/leave-requests/, "შვებულების მოთხოვნა"],
  [/^PUT \/api\/leave-requests\/[^/]+\/approve/, "შვებულების დადასტურება"],
  [/^PUT \/api\/leave-requests\/[^/]+\/reject/, "შვებულების უარყოფა"],
  [/^(POST|PUT) \/api\/attendance/, "სამსახურში ჩექინი / ჩექაუთი"],
  [/^POST \/api\/budgets/, "ბიუჯეტის შექმნა"],
  [/^(PUT|PATCH) \/api\/budgets/, "ბიუჯეტის შეცვლა"],
  [/^POST \/api\/employee-sales/, "აფთიაქის გაყიდვების შენახვა"],
  [/^POST \/api\/stocks/, "მარაგების ატვირთვა"],
  [/^POST \/api\/(doctors|drugs|hospitals|pharmacies|employees)/, "ახალი ჩანაწერის დამატება"],
  [/^(PUT|PATCH) \/api\/(doctors|drugs|hospitals|pharmacies|employees)/, "ჩანაწერის რედაქტირება"],
  [/^DELETE \/api\//, "წაშლა"],
  [/^GET \/api\/reports|^GET \/api\/director-dashboard|^GET \/api\/finance/, "რეპორტის ჩატვირთვა"],
  [/^POST \/api\/auth\/login/, "სისტემაში შესვლა"],
];
function actionFor(method, path) {
  const key = `${method} ${path}`;
  return (ACTIONS.find(([re]) => re.test(key)) || [null, null])[1];
}

// how to fix it, from the error text
function hintFor(msg) {
  const m = String(msg);
  let x;
  if ((x = m.match(/E11000 duplicate key[^{]*index: (\w+)_1 dup key: \{ (\w+): "?([^"}]*)"? \}/)))
    return `დუბლიკატი: ველი "${x[2]}" = "${x[3]}" უკვე არსებობს (უნიკალური ინდექსი ${x[1]}). შეამოწმე, როგორ ითვლება ეს მნიშვნელობა ახალი ჩანაწერისთვის.`;
  if (/E11000 duplicate key/.test(m)) return "დუბლიკატი: იგივე მნიშვნელობით ჩანაწერი უკვე არსებობს.";
  if ((x = m.match(/ValidationError: .*?Path `(\w+)` is required/)))
    return `სავალდებულო ველი აკლია: "${x[1]}". ფორმამ ეს ველი არ გამოაგზავნა.`;
  if ((x = m.match(/`([^`]+)` is not a valid enum value for path `(\w+)`/)))
    return `ველს "${x[2]}" არასწორი მნიშვნელობა მივიდა: "${x[1]}".`;
  if ((x = m.match(/Cast to ObjectId failed for value "?([^"]*)"? .*?path "(\w+)"/)))
    return `არასწორი ID ველში "${x[2]}": "${x[1]}" (ცარიელი ან წაშლილი ჩანაწერი?).`;
  if (/Cannot read propert(y|ies) of (null|undefined)/.test(m))
    return "კოდში რაღაც ცარიელია (null): სავარაუდოდ, ჩანაწერი წაშლილია ან ველი შეუვსებელია.";
  if (/Rate Limited/i.test(m)) return "გარე სერვისის ლიმიტი: ზედმეტად ბევრი მოთხოვნა წუთში. დაელოდე, ან შეანელე სკრიპტი.";
  if (/Unable to geocode|Invalid Request/i.test(m)) return "მისამართი ვერ მოიძებნა რუკაზე: გაასწორე მისამართი, ან კოორდინატები ხელით ჩაწერე.";
  if (/ECONNRESET|ETIMEDOUT|MongoNetworkError|server selection/i.test(m)) return "ბაზასთან კავშირი გაწყდა: ჩვეულებრივ თავისით აღდგება. თუ მეორდება, Atlas შეამოწმე.";
  if (/jwt|token/i.test(m)) return "შესვლის ტოკენის პრობლემა: მომხმარებელმა თავიდან უნდა შევიდეს.";
  return null;
}

console.error = (...args) => {
  originalConsoleError(...args);
  try {
    if (mongoose.connection.readyState !== 1) return; // not connected yet — skip silently
    const message = args
      .map((a) => (a instanceof Error ? `${a.message}\n${a.stack}` : typeof a === "string" ? a : JSON.stringify(a)))
      .join(" ")
      .slice(0, 2000);
    const req = requestStore.getStore()?.req;
    const emp = req?.employee;
    const path = req ? String(req.originalUrl || req.url || "").split("?")[0] : "";
    const doc = { message, hint: hintFor(message) };
    if (req) {
      Object.assign(doc, {
        method: req.method,
        apiPath: path,
        page: String(req.headers["x-page"] || "").slice(0, 200) || null,
        action: actionFor(req.method, path),
        query: req.originalUrl?.includes("?") ? req.originalUrl.split("?")[1].slice(0, 300) : null,
        bodyKeys: req.body && typeof req.body === "object" ? Object.keys(req.body).slice(0, 20).join(", ") : null,
      });
    }
    if (emp) {
      Object.assign(doc, {
        employeeId: emp._id,
        employeeName: `${emp.firstName || ""} ${emp.lastName || ""}`.trim(),
        employeeRole: emp.role?.name || null,
      });
    }
    ErrorLog.create(doc).catch(() => {});
  } catch {
    // logging must never crash the app
  }
};
