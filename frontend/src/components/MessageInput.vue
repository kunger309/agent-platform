<template>
  <div class="message-input">
    <textarea
      v-model="message"
      @keydown.enter="sendMessage"
      placeholder="Type your message..."
      rows="3"
    ></textarea>
    <div class="actions">
      <FileUploader @file-uploaded="handleFileUpload" />
      <AudioUploader @audio-uploaded="handleAudioUpload" />
      <button @click="sendMessage">Send</button>
    </div>
  </div>
</template>

<script >
import { defineComponent, ref } from 'vue';
import FileUploader from './FileUploader.vue';
import AudioUploader from './AudioUploader.vue';

export default defineComponent({
  components: {
    FileUploader,
    AudioUploader,
  },
  setup() {
    const message = ref('');

    const sendMessage = () => {
      if (message.value.trim()) {
        // Emit the message to the parent component or handle it here
        console.log('Message sent:', message.value);
        message.value = '';
      }
    };

    const handleFileUpload = (file) => {
      console.log('File uploaded:', file);
      // Handle file upload logic
    };

    const handleAudioUpload = (audio) => {
      console.log('Audio uploaded:', audio);
      // Handle audio upload logic
    };

    return {
      message,
      sendMessage,
      handleFileUpload,
      handleAudioUpload,
    };
  },
});
</script>

<style scoped>
.message-input {
  display: flex;
  flex-direction: column;
}

textarea {
  resize: none;
  padding: 10px;
  border: 1px solid #ccc;
  border-radius: 4px;
  margin-bottom: 10px;
}

.actions {
  display: flex;
  justify-content: space-between;
}
</style>