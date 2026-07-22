<template>
  <div class="chat-window">
    <div class="messages" ref="messagesContainer">
      <div v-for="(message, index) in messages" 
                     :key="index" 
                     :content="message.content" 
                     :isUser="message.isUser" />
    </div>
    <MessageInput @sendMessage="handleSendMessage" />
    <FileUploader @uploadFile="handleFileUpload" />
    <AudioUploader @uploadAudio="handleAudioUpload" />
  </div>
</template>

<script>
import { defineComponent, ref, onMounted } from 'vue';
// import TypingEffect from './TypingEffect.vue';
import MessageInput from './MessageInput.vue';
import FileUploader from './FileUploader.vue';
import AudioUploader from './AudioUploader.vue';
import { startSSE } from '../utils/sse';

export default defineComponent({
  components: {
    MessageInput,
    FileUploader,
    AudioUploader,
  },
  setup() {
    const messages = ref([]);
    const messagesContainer = ref(null);

    const handleSendMessage = (message) => {
      messages.value.push({ content: message, isUser: true });
      scrollToBottom();
      // Here you would also send the message to the server
    };

    const handleFileUpload = (file) => {
      messages.value.push({ content: `File uploaded: ${file.name}`, isUser: true });
      scrollToBottom();
      // Handle file upload logic here
    };

    const handleAudioUpload = (audio) => {
      messages.value.push({ content: `Audio uploaded: ${audio.name}`, isUser: true });
      scrollToBottom();
      // Handle audio upload logic here
    };

    const scrollToBottom = () => {
      if (messagesContainer.value) {
        messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
      }
    };

    onMounted(() => {
      startSSE((message) => {
        messages.value.push({ content: message, isUser: false });
        scrollToBottom();
      });
    });

    return {
      messages,
      messagesContainer,
      handleSendMessage,
      handleFileUpload,
      handleAudioUpload,
    };
  },
});
</script>

<style scoped>
.chat-window {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.messages {
  flex: 1;
  overflow-y: auto;
}

</style>