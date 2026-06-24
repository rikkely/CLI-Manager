import { toast } from "sonner";

export async function copyAiText(text: string, successMessage: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(successMessage);
  } catch (err) {
    toast.error("复制失败", { description: String(err) });
  }
}
