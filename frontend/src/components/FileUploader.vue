<template>
  <div class="file-uploader">
    <input type="file" @change="handleFileUpload" multiple />
    <button @click="uploadFiles">上传文件</button>
    <div v-if="uploading" class="uploading-indicator">上传中...</div>
    <ul>
      <li v-for="file in files" :key="file.name">{{ file.name }}</li>
    </ul>
  </div>
</template>

<script >
import { ref } from 'vue';

export default {
  name: 'FileUploader',
  setup() {
    const files = ref([]);
    const uploading = ref(false);

    const handleFileUpload = (event) => {
      const target = event.target;
      if (target.files) {
        for (let i = 0; i < target.files.length; i++) {
          files.value.push(target.files[i]);
        }
      }
    };

    const uploadFiles = async () => {
      if (files.value.length === 0) return;
      uploading.value = true;

      // 这里可以添加文件上传的逻辑，例如使用fetch或axios进行上传
      // 示例代码：
      // const formData = new FormData();
      // files.value.forEach(file => {
      //   formData.append('files[]', file);
      // });
      // await fetch('/upload', {
      //   method: 'POST',
      //   body: formData,
      // });

      // 模拟上传延迟
      setTimeout(() => {
        uploading.value = false;
        files.value = [];
        alert('文件上传成功！');
      }, 2000);
    };

    return {
      files,
      uploading,
      handleFileUpload,
      uploadFiles,
    };
  },
};
</script>

<style scoped>
.file-uploader {
  margin: 20px;
}

.uploading-indicator {
  color: blue;
  font-weight: bold;
}
</style>