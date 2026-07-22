<template>
  <div class="typing-effect">
    <span v-for="(char, index) in displayedText" :key="index">{{ char }}</span>
  </div>
</template>

<script >
import { ref, watch } from 'vue';

export default {
  name: 'TypingEffect',
  props: {
    text: {
      type: String,
      required: true
    },
    typingSpeed: {
      type: Number,
      default: 100
    }
  },
  setup(props) {
    const displayedText = ref('');

    const typeText = () => {
      let index = 0;
      displayedText.value = '';

      const interval = setInterval(() => {
        if (index < props.text.length) {
          displayedText.value += props.text.charAt(index);
          index++;
        } else {
          clearInterval(interval);
        }
      }, props.typingSpeed);
    };

    watch(() => props.text, () => {
      typeText();
    });

    return {
      displayedText
    };
  },
  mounted() {
    typeText();
  }
};
</script>

<style scoped>
.typing-effect {
  font-family: monospace;
  white-space: pre;
}
</style>