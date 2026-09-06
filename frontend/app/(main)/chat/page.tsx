import ChatWindow from "@/components/chat/ChatWindow"

export const metadata = { title: "베푸와 대화" }

export default function ChatPage() {
  return (
    <div className="h-screen">
      <ChatWindow userName="친구" speechStyle="informal" />
    </div>
  )
}
