import { PsychBackdrop } from "@/components/PsychBackdrop";
import { SessionFlow } from "@/components/SessionFlow";

export default function Home() {
  return (
    <>
      <PsychBackdrop />
      <div className="relative z-10 flex min-h-full flex-col px-4 py-8 sm:px-6 sm:py-10">
        <SessionFlow />
      </div>
    </>
  );
}
