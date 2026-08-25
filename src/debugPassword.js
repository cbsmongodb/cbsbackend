import bcrypt from "bcryptjs";

const hashFromDatabase = "$2a$10$zBZeyh.fVhK/4c6cWWt.rOjFgfccSsrZyjrhmOPkGDeOa0Hk7D9PG";
const passwordYouTypeInPostman = "Lbogver12";

bcrypt.compare(passwordYouTypeInPostman, hashFromDatabase).then((matches) => {
  console.log("Password matches hash:", matches);
});
