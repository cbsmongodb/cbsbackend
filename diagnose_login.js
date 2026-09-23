import mongoose from "mongoose";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import Employee from "./src/models/Employee.js";

dotenv.config();

async function main() {
  await mongoose.connect(process.env.MONGO_URI);

  const rawEmail = "lbogveradze12@gmail.com";
  const testPassword = "123456";

  const employee = await Employee.findOne({ email: rawEmail.toLowerCase() }).select("+password");

  if (!employee) {
    console.log(`NO EMPLOYEE FOUND for email: "${rawEmail.toLowerCase()}"`);
    console.log("Searching for anything close...");
    const similar = await Employee.find({ email: { $regex: "lbogveradze", $options: "i" } }).select("email isActive");
    console.log("Similar matches:", JSON.stringify(similar, null, 2));
    await mongoose.disconnect();
    return;
  }

  console.log("Employee found:");
  console.log("  _id:", employee._id);
  console.log("  email (exact, with quotes):", JSON.stringify(employee.email));
  console.log("  isActive:", employee.isActive);
  console.log("  password hash length:", employee.password?.length);
  console.log("  password hash prefix:", employee.password?.slice(0, 10));

  const compareResult = await bcrypt.compare(testPassword, employee.password);
  console.log(`\nbcrypt.compare("${testPassword}", storedHash) =`, compareResult);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
