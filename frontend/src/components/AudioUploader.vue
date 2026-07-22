<template>
  <div class="audio-uploader">
    <input type="file" accept="audio/*" @change="onFileChange" />
    <button @click="uploadAudio" :disabled="!selectedFile">上传音频</button>
  </div>
</template>

<script >
import { ref } from 'vue';

export default {
  name: 'AudioUploader',
  setup() {
    const selectedFile = ref<File | null>(null);

    const onFileChange = (event) => {
      const target = event.target;
      if (target.files && target.files.length > 0) {
        selectedFile.value = target.files[0];
      }
    };

    const uploadAudio = () => {
      if (selectedFile.value) {
        const formData = new FormData();
        formData.append('audio', selectedFile.value);

        // 这里可以添加上传音频的逻辑，例如使用fetch或axios
        console.log('Uploading audio file:', selectedFile.value.name);
      }
    };

    return {
      selectedFile,
      onFileChange,
      uploadAudio,
    };
  },
};
</script>

<style scoped>
.audio-uploader {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.audio-uploader input {
  margin-bottom: 10px;
}
</style>