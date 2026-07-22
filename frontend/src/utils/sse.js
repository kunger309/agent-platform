import { ref } from 'vue';

export function startSSE(url) {
    const messages = ref([]);
    const eventSource = new EventSource(url);

    eventSource.onmessage = (event) => {
        const data = JSON.parse(event.data);
        messages.value.push(data);
    };

    eventSource.onerror = (error) => {
        console.error("SSE error:", error);
        eventSource.close();
    };

    const closeConnection = () => {
        eventSource.close();
    };

    return {
        messages,
        closeConnection
    };
}