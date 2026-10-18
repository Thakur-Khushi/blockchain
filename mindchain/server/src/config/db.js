import mongoose from 'mongoose';

// Query-operator injection (e.g. {"$gt": ""}) is prevented by validating every
// request input with zod to primitive types before it reaches a query.
mongoose.set('strictQuery', true);

export async function connectDatabase(uri) {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  // Build indexes declared on the models (unique email, wallet, etc.).
  await mongoose.connection.syncIndexes();
  return mongoose.connection;
}

export async function disconnectDatabase() {
  await mongoose.disconnect();
}
