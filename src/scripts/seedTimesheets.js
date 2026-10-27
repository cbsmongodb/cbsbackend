// Creates the 8 timesheets (ტაბელი) and their people, taken from the company's
// own Excel timesheets (October 2025), and gives the report to the people who
// see "Leave for payroll". Safe to run again: an existing timesheet is left as it is.
//   node src/scripts/seedTimesheets.js
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import TimesheetSheet from "../models/TimesheetSheet.js";
import TimesheetMember from "../models/TimesheetMember.js";
import Employee from "../models/Employee.js";
import Section from "../models/Section.js";
import Role from "../models/Role.js";

const SHEETS = [
 {
  "key": "div1-tbilisi",
  "title": "დივიზიონი 1 თბილისი",
  "section": "1 DIVIZION",
  "head": "თამარ ჯინჯოლავა",
  "responsible": "ლია ქავთარაძე",
  "members": [
   {
    "nameKa": "თამარ ჯინჯოლავა",
    "personalId": "42001005058",
    "position": "დივიზიონის მენეჯერი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "tamunajinjolava@yahoo.com"
   },
   {
    "nameKa": "თამუნა ჭკადუა",
    "personalId": "30001008432",
    "position": "პროდუქციის მენეჯერი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "tchkaduatamuna@gmail.com"
   },
   {
    "nameKa": "ნანა ბერიანიძე",
    "personalId": "24001006125",
    "position": "ჯგუფის მენეჯერი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "nanberianidze@gmail.com"
   },
   {
    "nameKa": "ლუდმილა გაგნიძე",
    "personalId": "25001032500",
    "position": "სამ. წარმომადგენელი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "milagagnidze@mail.ru"
   },
   {
    "nameKa": "თეა შუბითიძე",
    "personalId": "57001049525",
    "position": "სამ. წარმომადგენელი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "t.shubitidze@cbs.ge"
   },
   {
    "nameKa": "ლანა კახიძე",
    "personalId": "01005022470",
    "position": "სამ. წარმომადგენელი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "l.kakhidze@cbs.ge"
   },
   {
    "nameKa": "ნათია წულაია",
    "personalId": "58001001598",
    "position": "სამ. წარმომადგენელი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "natushkiculaia@mail.ru"
   },
   {
    "nameKa": "მეგი თენაძე",
    "personalId": "59001029029",
    "position": "ჯგუფის მენეჯერი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "m.tenadze@cbs.ge"
   },
   {
    "nameKa": "ნანა ხეცურიანი",
    "personalId": "62005023711",
    "position": "სამ. წარმომადგენელი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "nana.xecuriani@inbox.ru"
   },
   {
    "nameKa": "დიანა ფრუიძე",
    "personalId": "62007013180",
    "position": "სამ. წარმომადგენელი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "pruidzediko@gmail.com"
   },
   {
    "nameKa": "ნატა არჩვაძე",
    "personalId": "01019032269",
    "position": "სამ. წარმომადგენელი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "n.archvadze@cbs.ge"
   },
   {
    "nameKa": "ნაზი ფარეშიშვილი",
    "personalId": "01001045005",
    "position": "სამ. წარმომადგენელი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "n.phareshishvili@gmail.com"
   },
   {
    "nameKa": "თამუნა ღონღაძე",
    "personalId": "59001014648",
    "position": "ჯგუფის მენეჯერი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "t.gongadze@mail.ru"
   },
   {
    "nameKa": "ინგა კუჭავა",
    "personalId": "42001005156",
    "position": "სამ. წარმომადგენელი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "ingakuchava@gmail.com"
   },
   {
    "nameKa": "მარიამ ხინველი",
    "personalId": "35001001211",
    "position": "სამ. წარმომადგენელი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "mkhinveli@mail.ru"
   },
   {
    "nameKa": "თამარ ალიბეგაშვილი",
    "personalId": "01010016108",
    "position": "სამ. წარმომადგენელი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "tatalibegashvili@gmail.com"
   },
   {
    "nameKa": "რუსუდან თიგიშვილი",
    "personalId": "01036000811",
    "position": "სამ. წარმომადგენელი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "r.tigishvili@cbs.ge"
   }
  ]
 },
 {
  "key": "div1-region",
  "title": "დივიზიონი 1 რეგიონი",
  "section": "1 DIVIZION",
  "head": "თამარ ჯინჯოლავა",
  "responsible": "ლია ქავთარაძე",
  "members": [
   {
    "nameKa": "ანა შავერდაშვილი",
    "personalId": "13001019510",
    "position": "სამ. წარმომადგენელი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "a.shaverdashvili@cbs.ge"
   },
   {
    "nameKa": "თამარ საგინაშვილი",
    "personalId": "24001005123",
    "position": "სამ. წარმომადგენელი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "tamuna.saguinashvili@mail.ru"
   },
   {
    "nameKa": "მელანო კუჭავა",
    "personalId": "42001011181",
    "position": "სამ. წარმომადგენელი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "m.kuchava@cbs.ge"
   },
   {
    "nameKa": "ხატია ჯავახაძე",
    "personalId": "60001089410",
    "position": "სამ. წარმომადგენელი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "kh.djavakhadze@cbs.ge"
   },
   {
    "nameKa": "ნინო სულაკაძე",
    "personalId": "60001077599",
    "position": "სამ. წარმომადგენელი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "n.sulakadze@cbs.ge"
   },
   {
    "nameKa": "ნათია პატარიძე",
    "personalId": "61002009319",
    "position": "სამ. წარმომადგენელი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "n.pataridze@cbs.ge"
   },
   {
    "nameKa": "ნათია გაგუა",
    "personalId": "61001011908",
    "position": "სამ. წარმომადგენელი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "n.gagua@cbs.ge"
   },
   {
    "nameKa": "ნინო ჟივიძე",
    "personalId": "24001004331",
    "position": "სამ. წარმომადგენელი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "n.zhividze@cbs.ge"
   }
  ]
 },
 {
  "key": "div2-tbilisi",
  "title": "დივიზიონი 2 თბილისი",
  "section": "2 DIVIZION",
  "head": "რუსუდან აბზიანიძე",
  "responsible": "ლია ქავთარაძე",
  "members": [
   {
    "nameKa": "რუსუდან აბზიანიძე",
    "personalId": "01027021521",
    "position": "დივიზიონის მენეჯერი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "rusa_2004@mail.ru"
   },
   {
    "nameKa": "სოფო ქაჯაია",
    "personalId": "37001007363",
    "position": "ჯგუფის მენეჯერი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "sofo.qajaia82@mail.ru"
   },
   {
    "nameKa": "თამარ ბერიაშვილი",
    "personalId": "40001008078",
    "position": "სამ. წარმომადგენელი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "takoberiashvili@mail.ru"
   },
   {
    "nameKa": "ელისო ლეკიშვილი",
    "personalId": "10001049735",
    "position": "სამ. წარმომადგენელი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "e.lekishvili@cbs.ge"
   },
   {
    "nameKa": "ქრისტინა ვეკუა",
    "personalId": "62409008474",
    "position": "სამ. წარმომადგენელი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "vekua_kristine@gmail.com"
   },
   {
    "nameKa": "თამარ გლახოშვილი",
    "personalId": "39001006392",
    "position": "სამ. წარმომადგენელი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "tamarglakhoshvili@gmail.com"
   },
   {
    "nameKa": "მარიამ გელაშვილი",
    "personalId": "57001049483",
    "position": "სამ. წარმომადგენელი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "mariko@europe.com"
   },
   {
    "nameKa": "ხათუნა ბიჭიაშვილი",
    "personalId": "01011003150",
    "position": "ჯგუფის მენეჯერი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "xatoaxsis@yahoo.com"
   },
   {
    "nameKa": "თამთა ეზიეშვილი",
    "personalId": "01014005953",
    "position": "სამ. წარმომადგენელი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "tamtaezieshvili53@gmail.com"
   },
   {
    "nameKa": "თინათინ ფარცხალაძე",
    "personalId": "55001021669",
    "position": "სამ. წარმომადგენელი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "tinatini_parcxaladze@yahoo.com"
   },
   {
    "nameKa": "ნანა ამბროლაძე",
    "personalId": "01024076748",
    "position": "სამ. წარმომადგენელი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "ambroladzenanuka23@gmail.com"
   },
   {
    "nameKa": "თამარ ლიპარტელიანი",
    "personalId": "01027009589",
    "position": "ჯგუფის მენეჯერი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "tamuna.tamuna79@yahoo.com"
   },
   {
    "nameKa": "ლიკა ცისკარაშვილი",
    "personalId": "13001059368",
    "position": "სამ. წარმომადგენელი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "l.ciskarishvili@cbs.ge"
   },
   {
    "nameKa": "ეკატერინე ქუფარაშვილი",
    "personalId": "40001000253",
    "position": "სამ. წარმომადგენელი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "e.qupharashvili@cbs.ge"
   },
   {
    "nameKa": "ია ვახტანგიშვილი",
    "personalId": "01027074257",
    "position": "სამ. წარმომადგენელი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "i.vakhtangishvili@cbs.ge"
   }
  ]
 },
 {
  "key": "div2-region",
  "title": "დივიზიონი 2 რეგიონი",
  "section": "2 DIVIZION",
  "head": "რუსუდან აბზიანიძე",
  "responsible": "ლია ქავთარაძე",
  "members": [
   {
    "nameKa": "ნანული ნაკაიძე",
    "personalId": "61006014640",
    "position": "რეგიონალური მენეჯერი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "nana_nakaidze@mail.ru"
   },
   {
    "nameKa": "მაია ქართველიშვილი",
    "personalId": "20001053248",
    "position": "სამ.წარმომადგენელი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "maia.kartvelishvili1@gmail.com"
   },
   {
    "nameKa": "მაია სიხაშვილი",
    "personalId": "40001029118",
    "position": "სამ.წარმომადგენელი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "m.sikhashvili@cbs.ge"
   },
   {
    "nameKa": "ნინო გიორგაძე",
    "personalId": "60001126341",
    "position": "სამ.წარმომადგენელი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "n.giorgadze@cbs.ge"
   },
   {
    "nameKa": "თეონა გიგაშვილი",
    "personalId": "21001037431",
    "position": "სამ.წარმომადგენელი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "t.gigashvili@cbs.ge"
   },
   {
    "nameKa": "მაია ყარალაშვილი",
    "personalId": "40001009805",
    "position": "სამ.წარმომადგენელი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "m.karalashvili@cbs.ge"
   },
   {
    "nameKa": "მარიკა კუპატაძე",
    "personalId": "21001040825",
    "position": "სამ.წარმომადგენელი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "m.kupatadze@cbs.ge"
   },
   {
    "nameKa": "ცირა ბაკარანძე",
    "personalId": "19001092182",
    "position": "სამ.წარმომადგენელი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "cbakaradze@gmail.com"
   },
   {
    "nameKa": "გაიანე ირიციანი",
    "personalId": "07001041400",
    "position": "სამ.წარმომადგენელი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "lina-lina88@mail.ru"
   }
  ]
 },
 {
  "key": "div3-tbilisi",
  "title": "დივიზიონი 3 თბილისი",
  "section": "3 DIVIZION",
  "head": "ქეთევან ჯალაღონია",
  "responsible": "ლია ქავთარაძე",
  "members": [
   {
    "nameKa": "ქეთევან ჯალაღონია",
    "personalId": "35001019483",
    "position": "დივიზიონის მენეჯერი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "kjalaghonia@yahoo.com"
   },
   {
    "nameKa": "ნათია ბადრიძე",
    "personalId": "01022002463",
    "position": "პროდუქციის მენეჯერი",
    "hours": 4,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "natiabadridze@gmail.com"
   },
   {
    "nameKa": "ციცინო მერაბიშვილი",
    "personalId": "03001003567",
    "position": "ჯგუფის მენეჯერი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "cici.merabishvili@mail.ru"
   },
   {
    "nameKa": "ია წიწილაშვილი",
    "personalId": "01009001481",
    "position": "სამ. წარმომადგენელი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "tsitsila@mail.ru"
   },
   {
    "nameKa": "მაკა ოდიშარია",
    "personalId": "29001035173",
    "position": "სამ. წარმომადგენელი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "makaodisharia91@gmail.com"
   },
   {
    "nameKa": "ანა მესხიშვილი",
    "personalId": "40001029349",
    "position": "სამ. წარმომადგენელი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "ana.mesxishvili.89@gmail.com"
   },
   {
    "nameKa": "თამარ მაისურაძე",
    "personalId": "01001036511",
    "position": "სამ. წარმომადგენელი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "t.maisuradze@cbs.ge"
   },
   {
    "nameKa": "ლიზა გულაშვილი",
    "personalId": "13001005109",
    "position": "ჯგუფის მენეჯერი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "gulashvililizi@gmail.com"
   },
   {
    "nameKa": "მარიამ ჯანიაშვილი",
    "personalId": "22001004402",
    "position": "სამ. წარმომადგენელი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "janiashvili_m@mail.ru"
   },
   {
    "nameKa": "ნინო თორდია",
    "personalId": "01014003640",
    "position": "სამ. წარმომადგენელი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "tordia-84@mail.ru"
   },
   {
    "nameKa": "შორენა პაპაშვილი",
    "personalId": "13001027417",
    "position": "სამ. წარმომადგენელი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "shorena_papashvili@mail.ru"
   },
   {
    "nameKa": "თამარ გოდერძიშვილი",
    "personalId": "40001009997",
    "position": "სამ. წარმომადგენელი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "t.goderdzishvili@cbs.ge"
   },
   {
    "nameKa": "ხათუნა მოსეშვილი",
    "personalId": "40001006911",
    "position": "სამ. წარმომადგენელი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "xato.mose@mail.ru"
   },
   {
    "nameKa": "თამუნა გოცირიძე",
    "personalId": "60001004381",
    "position": "ჯგუფის მენეჯერი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "gotciridzetamuna@mail.ru"
   },
   {
    "nameKa": "ლანა ოთარაშვილი",
    "personalId": "01027041482",
    "position": "სამ. წარმომადგენელი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "lana.otarashvili@mail.ru"
   },
   {
    "nameKa": "ნინო ბასილიძე",
    "personalId": "59001028676",
    "position": "სამ. წარმომადგენელი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": null
   },
   {
    "nameKa": "ნინო როსტიაშვილი",
    "personalId": "010030114396",
    "position": "სამ. წარმომადგენელი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "nino_rostiashvili@mail.ru"
   },
   {
    "nameKa": "ნატო ჯავახიშვილი",
    "personalId": "40001007702",
    "position": "სამ. წარმომად",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "nata.javakhishvili@yahoo.com"
   }
  ]
 },
 {
  "key": "div3-region",
  "title": "დივიზიონი 3 რეგიონი",
  "section": "3 DIVIZION",
  "head": "ქეთევან ჯალაღონია",
  "responsible": "ლია ქავთარაძე",
  "members": [
   {
    "nameKa": "ქეთევან ქარდავა",
    "personalId": "19001000517",
    "position": "სამ.წარმომადგენელი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "k.kardava@cbs.ge"
   },
   {
    "nameKa": "დარეჯან ბუაძე",
    "personalId": "60001091429",
    "position": "სამ.წარმომადგენელი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "darejanbuadze@gmail.com"
   },
   {
    "nameKa": "ლია კიკაბიძე",
    "personalId": "60001051255",
    "position": "სამ.წარმომადგენელი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "kikanini09@gmail.com"
   },
   {
    "nameKa": "მაკა ოსიაშვილი",
    "personalId": "13001031028",
    "position": "სამ.წარმომადგენელი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "m.osiashvili@cbs.ge"
   },
   {
    "nameKa": "მაია თავდგირიძე",
    "personalId": "61010003640",
    "position": "სამ.წარმომადგენელი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "maia.tavdgiridze85@gmail.com"
   },
   {
    "nameKa": "ელენე ხულორდავა",
    "personalId": "51001022437",
    "position": "სამ.წარმომადგენელი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "e.khulordava@cbs.ge"
   },
   {
    "nameKa": "თამარ ბალაბანაშვილი",
    "personalId": "47001010683",
    "position": "სამ.წარმომადგენელი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "t.balabanashvili@cbs.ge"
   }
  ]
 },
 {
  "key": "office",
  "title": "ოფისი",
  "section": null,
  "head": "ლია ქავთარაძე",
  "responsible": "ლია ქავთარაძე",
  "members": [
   {
    "nameKa": "რუმაისა შამიმ",
    "personalId": "01592004649",
    "position": "მარკეტინგის დირექტორი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "r.shamim@cbs.ge"
   },
   {
    "nameKa": "ფატიმა შამიმ",
    "personalId": "01992004688",
    "position": "სოც.ქსელის მართვის მენეჯერი",
    "hours": 4,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": null
   },
   {
    "nameKa": "ზორა შამიმ",
    "personalId": "01992004687",
    "position": "სოც.ქსელის მართვის მენეჯერი",
    "hours": 4,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "shamim.zohra26@gmail.com"
   },
   {
    "nameKa": "სამარ შამიმ",
    "personalId": "01592004689",
    "position": "ღონისძიებების მენეჯერის ასისტენტი",
    "hours": 4,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": null
   },
   {
    "nameKa": "ნატალია გივიშვილი",
    "personalId": "01001024205",
    "position": "დიასახლისი/დამლაგებელი",
    "hours": 2,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": null
   },
   {
    "nameKa": "ავინაშ",
    "personalId": "01092001273",
    "position": "რეგისტრაციის მენეჯერი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "avinash@cbs.ge"
   },
   {
    "nameKa": "თეა ქობელაშვილი",
    "personalId": "01002021605",
    "position": "ფინანსური მენეჯერი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "finance@cbs.ge"
   },
   {
    "nameKa": "ირაკლი ვეკუა",
    "personalId": "01012013647",
    "position": "ბუღალტერი/ლოჯისტიკის მენეჯერი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "info@cbs.ge"
   },
   {
    "nameKa": "ლიკა ქავთარაძე",
    "personalId": "01001098073",
    "position": "ოფისის მენეჯერი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "l.kavtaradze@cbs.ge"
   },
   {
    "nameKa": "თეა ფერაძე",
    "personalId": "11001001640",
    "position": "ბუღალტრის თანაშემწე",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "teaperadze@gmail.com"
   },
   {
    "nameKa": "გოგოლაძე თეა",
    "personalId": "01012015148",
    "position": "მედიკამენტების რეგისტრაციის მენეჯერი",
    "hours": 8,
    "workDays": [
     1,
     3,
     4,
     5
    ],
    "email": "t.gogoladze@cbs.ge"
   },
   {
    "nameKa": "აგნესა ბართაია",
    "personalId": "01024034254",
    "position": "იურისტი",
    "hours": 8,
    "workDays": [
     2,
     3,
     4
    ],
    "email": null
   }
  ]
 },
 {
  "key": "warehouse",
  "title": "საწყობი",
  "section": null,
  "head": "ნინო მიმინოშვილი",
  "responsible": "ლია ქავთარაძე",
  "members": [
   {
    "nameKa": "ნინო მიმინოშვილი",
    "personalId": "02001002841",
    "position": "საწყობის პასუხისმგებელი პირი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "alla_nino_mimino@yahoo.com"
   },
   {
    "nameKa": "თემური მიმინოშვილ",
    "personalId": "02001003389",
    "position": "პროდუქციის ხარისხის მენეჯერი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "t.miminoshvili@cbs.ge"
   },
   {
    "nameKa": "ილია ბიწკინაშვილი",
    "personalId": "01017016115",
    "position": "მძღოლი დისტრიბუტორი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "i.bitskinashvili@cbs.ge"
   },
   {
    "nameKa": "ნაილი ბიწკინაშვილი",
    "personalId": "01017025496",
    "position": "საწყობის პასუხისმგებელი პირის თანაშ",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "n.bitskinashvili@cbs.ge"
   },
   {
    "nameKa": "ბორის ზიბზიბაძე",
    "personalId": "62001001059",
    "position": "მძღოლი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": null
   },
   {
    "nameKa": "თორნიკე ჯგერენაია",
    "personalId": "29001037726",
    "position": "მძღოლი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "jgerenaia1905@gmail.com"
   },
   {
    "nameKa": "ლევან სოლომნიშვილი",
    "personalId": "13001013570",
    "position": "მძღოლი",
    "hours": 8,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": "lsolomnishvili08@gmail.com"
   },
   {
    "nameKa": "მაია გიაშვილი",
    "personalId": "13001020236",
    "position": "დიასახლისი/დამლაგებელი",
    "hours": 2,
    "workDays": [
     1,
     2,
     3,
     4,
     5
    ],
    "email": null
   }
  ]
 }
];

await connectDB();
let order = 0;
for (const s of SHEETS) {
  order++;
  const section = s.section ? await Section.findOne({ name: s.section }).select("_id").lean() : null;
  if (s.section && !section) console.log(`⚠️  division "${s.section}" not found — ${s.title} is visible only to director / finance / office`);
  const existing = await TimesheetSheet.findOne({ key: s.key });
  if (existing) { console.log(`ℹ️  ${s.title}: already exists, not changed`); continue; }
  await TimesheetSheet.create({ key: s.key, title: s.title, section: section?._id || null, head: s.head || "", responsible: s.responsible || "", order });
  let linked = 0, i = 0;
  for (const m of s.members) {
    const emp = m.email ? await Employee.findOne({ email: m.email.toLowerCase() }).select("_id").lean() : null;
    if (emp) linked++;
    await TimesheetMember.create({ sheet: s.key, employee: emp?._id || null, nameKa: m.nameKa, personalId: m.personalId, position: m.position, hours: m.hours, workDays: m.workDays, order: ++i });
  }
  console.log(`✅ ${s.title}: ${s.members.length} people (${linked} linked to CRM)`);
}

// who sees the report: same roles as "Leave for payroll"
const ON = { read: 1, add: 1, update: 1, delete: 1, import: 0, export: 1, dashboard: 0, live_feeds: 0, last_locations: 0, analytics: 0 };
const roles = await Role.find({}).lean();
const tea = await Employee.findOne({ email: "finance@cbs.ge" }).select("role").lean();
for (const r of roles) {
  const name = r.name.toLowerCase().trim();
  if (!["division manager", "director", "finance manager", "office manager"].includes(name) && String(r._id) !== String(tea?.role)) continue;
  const role = await Role.findById(r._id);
  role.privileges.set("timesheet_report", ON);
  role.markModified("privileges");
  await role.save();
  console.log(`🔑 ${r.name}: timesheet report`);
}
await mongoose.disconnect();
