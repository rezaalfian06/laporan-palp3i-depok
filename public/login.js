const loginForm = document.querySelector('#loginForm');
const errorBox = document.querySelector('#loginError');

function redirectForRole(role) {
  window.location.assign(role === 'admin' ? '/admin/dashboard' : '/user/dashboard');
}

loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  errorBox.textContent = '';
  const formData = new FormData(loginForm);
  const submitButton = document.querySelector('#loginSubmitBtn');
  submitButton.disabled = true;

  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: formData.get('username'),
        password: formData.get('password'),
        role: loginForm.dataset.role,
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || result.error || 'Login gagal.');
    if (!result.user) throw new Error('Server tidak mengembalikan sesi login yang valid.');
    redirectForRole(result.user.role);
  } catch (error) {
    errorBox.textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
});
