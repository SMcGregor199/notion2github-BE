import {config} from "dotenv";
config();
export default function getEnvValue(name: string): string {
  const value = process.env[name];
  if (!value){
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}