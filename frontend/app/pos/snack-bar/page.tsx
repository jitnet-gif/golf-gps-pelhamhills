import PosRegister from "@/components/pos/PosRegister";

export const metadata = { title: "Snack Bar" };

export default function PosSnackBarPage() {
  return <PosRegister station="snack-bar" />;
}
