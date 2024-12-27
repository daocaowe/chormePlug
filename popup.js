let currentBookmark = null;

// 添加分页相关的全局变量
const PAGE_SIZE = 20; // 每页显示的书签数量
let currentPage = 1;
let allBookmarks = []; // 存储所有书签
let filteredBookmarks = []; // 存储筛选后的书签

// 添加批量操作相关的全局变量
let batchMode = false;
let selectedBookmarks = new Set();

document.addEventListener('DOMContentLoaded', function() {
  loadBookmarks();
  setupEventListeners();
});

function setupEventListeners() {
  document.getElementById('addCategoryBtn').addEventListener('click', () => {
    const category = prompt('请输入新分类名称：');
    if (category) {
      addNewCategory(category);
    }
  });
  
  document.getElementById('saveCategoryBtn').addEventListener('click', saveBookmarkCategory);
  document.getElementById('cancelCategoryBtn').addEventListener('click', closeModal);
  document.getElementById('manageCategoriesBtn').addEventListener('click', showCategoryManageModal);
  document.getElementById('closeManageBtn').addEventListener('click', closeCategoryManageModal);
  
  const searchInput = document.getElementById('searchInput');
  const clearSearchBtn = document.getElementById('clearSearchBtn');
  
  searchInput.addEventListener('input', handleSearch);
  clearSearchBtn.addEventListener('click', clearSearch);
  
  document.getElementById('batchModeBtn').addEventListener('click', toggleBatchMode);
  document.getElementById('cancelBatchBtn').addEventListener('click', cancelBatchMode);
  document.getElementById('batchDeleteBtn').addEventListener('click', deleteBatchBookmarks);
  document.getElementById('batchCategorySelect').addEventListener('change', setBatchCategory);
  
  setupTheme();
  setupSettings();
}

function loadBookmarks() {
  // 获取保存的分类数据
  chrome.storage.sync.get(['categories', 'bookmarkCategories'], function(data) {
    const categories = data.categories || ['常用', '工作', '学习', '娱乐', '其他'];
    const bookmarkCategories = data.bookmarkCategories || {};
    
    // 更新分类列表
    updateCategoryList(categories);
    
    // 加载书签
    chrome.bookmarks.getTree(function(bookmarkTreeNodes) {
      processBookmarks(bookmarkTreeNodes[0].children, bookmarkCategories);
    });
  });
}

function updateCategoryList(categories) {
  const categoryList = document.querySelector('.category-list');
  categoryList.innerHTML = '';
  
  categories.forEach(category => {
    const li = document.createElement('li');
    li.className = 'category-item';
    li.textContent = category;
    
    // 添加拖拽相关事件
    li.addEventListener('dragover', (e) => {
      e.preventDefault();
      li.classList.add('drag-over');
    });
    
    li.addEventListener('dragleave', () => {
      li.classList.remove('drag-over');
    });
    
    li.addEventListener('drop', (e) => {
      e.preventDefault();
      li.classList.remove('drag-over');
      
      const bookmarkId = e.dataTransfer.getData('text/plain');
      if (bookmarkId) {
        chrome.storage.sync.get(['bookmarkCategories'], function(data) {
          const bookmarkCategories = data.bookmarkCategories || {};
          bookmarkCategories[bookmarkId] = category;
          
          chrome.storage.sync.set({ bookmarkCategories }, function() {
            loadBookmarks(); // 重新加载以更新显示
          });
        });
      }
    });
    
    li.addEventListener('click', () => selectCategory(category));
    categoryList.appendChild(li);
  });
}

function createBookmarkElement(bookmark, category) {
  const li = document.createElement('li');
  li.className = 'bookmark-item';
  
  // 添加复选框
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'bookmark-checkbox';
  
  // 创建左侧内容容器
  const leftContent = document.createElement('div');
  leftContent.className = 'bookmark-left';
  
  const favicon = document.createElement('img');
  favicon.src = `chrome://favicon/${bookmark.url}`;
  favicon.className = 'favicon';
  
  const link = document.createElement('a');
  link.href = bookmark.url;
  link.textContent = bookmark.title;
  link.target = '_blank';
  
  leftContent.appendChild(favicon);
  leftContent.appendChild(link);
  
  // 创建右侧操作容器
  const actions = document.createElement('div');
  actions.className = 'bookmark-actions';
  
  // 分类标签（可点击设置分类）
  const categoryTag = document.createElement('button');
  categoryTag.className = 'category-tag';
  categoryTag.textContent = category || '未分类';
  categoryTag.title = '点击设置分类';
  categoryTag.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    showCategoryModal(bookmark);
  });
  
  // 删除按钮
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'delete-btn';
  deleteBtn.innerHTML = '×';
  deleteBtn.title = '删除书签';
  deleteBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (confirm('确定要删除这个书签吗？')) {
      try {
        // 获取所有相关标签页
        const tabs = await chrome.tabs.query({ url: bookmark.url });
        
        // 删除书签
        await new Promise(resolve => chrome.bookmarks.remove(bookmark.id, resolve));
        
        // 删除相关标签页
        if (tabs.length > 0) {
          await chrome.tabs.remove(tabs.map(tab => tab.id));
        }
        
        // 删除分类数据
        chrome.storage.sync.get(['bookmarkCategories'], function(data) {
          const bookmarkCategories = data.bookmarkCategories || {};
          delete bookmarkCategories[bookmark.id];
          chrome.storage.sync.set({ bookmarkCategories }, function() {
            // 从列表中移除元素
            li.remove();
          });
        });
        
        showNotification('书签已删除');
      } catch (error) {
        showNotification('删除失败：' + error.message, 'error');
      }
    }
  });
  
  actions.appendChild(categoryTag);
  actions.appendChild(deleteBtn);
  
  li.appendChild(checkbox);
  li.appendChild(leftContent);
  li.appendChild(actions);
  
  // 添加拖拽相关属性和事件
  li.draggable = true;
  li.dataset.bookmarkId = bookmark.id;
  
  li.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', bookmark.id);
    li.classList.add('dragging');
  });
  
  li.addEventListener('dragend', () => {
    li.classList.remove('dragging');
  });
  
  // 添加选择功能
  li.addEventListener('click', (e) => {
    if (batchMode && e.target !== link) {
      e.preventDefault();
      li.classList.toggle('selected');
      if (li.classList.contains('selected')) {
        selectedBookmarks.add(bookmark.id);
      } else {
        selectedBookmarks.delete(bookmark.id);
      }
      updateSelectedCount();
    }
  });
  
  return li;
}

function showCategoryModal(bookmark) {
  currentBookmark = bookmark;
  const modal = document.getElementById('categoryModal');
  modal.style.display = 'block';
  
  // 更新分类选择列表
  updateCategorySelect();
}

function closeModal() {
  const modal = document.getElementById('categoryModal');
  modal.style.display = 'none';
  currentBookmark = null;
}

function saveBookmarkCategory() {
  if (!currentBookmark) return;
  
  const select = document.getElementById('categorySelect');
  const category = select.value;
  
  chrome.storage.sync.get(['bookmarkCategories'], function(data) {
    const bookmarkCategories = data.bookmarkCategories || {};
    bookmarkCategories[currentBookmark.id] = category;
    
    chrome.storage.sync.set({ bookmarkCategories }, function() {
      closeModal();
      loadBookmarks(); // 重新加载以更新显示
    });
  });
}

function addNewCategory(category) {
  chrome.storage.sync.get(['categories'], function(data) {
    const categories = data.categories || ['常用', '工作', '学习', '娱乐', '其他'];
    if (!categories.includes(category)) {
      categories.push(category);
      chrome.storage.sync.set({ categories }, function() {
        updateCategoryList(categories);
      });
    }
  });
}

function selectCategory(category) {
  const searchInput = document.getElementById('searchInput');
  const searchText = searchInput.value.toLowerCase();
  
  // 筛选书签
  filteredBookmarks = allBookmarks.filter(bookmark => {
    const matchesCategory = category === '全部' || bookmark.category === category;
    const matchesSearch = !searchText || 
      bookmark.node.title.toLowerCase().includes(searchText) || 
      bookmark.node.url.toLowerCase().includes(searchText);
    return matchesCategory && matchesSearch;
  });
  
  // 重置分页并重新加载
  resetBookmarksList();
}

function processBookmarks(bookmarkNodes, bookmarkCategories) {
  const bookmarkList = document.querySelector('.bookmark-list');
  bookmarkList.innerHTML = ''; // 清空现有内容
  
  // 创建书签容器
  const bookmarksContainer = document.createElement('ul');
  bookmarksContainer.className = 'bookmarks-container';
  bookmarkList.appendChild(bookmarksContainer);
  
  // 收集所有书签
  allBookmarks = [];
  
  function collectBookmarks(nodes) {
    nodes.forEach(node => {
      if (node.children) {
        collectBookmarks(node.children);
      } else if (node.url) {
        allBookmarks.push({
          node: node,
          category: bookmarkCategories[node.id] || '未分类'
        });
      }
    });
  }
  
  collectBookmarks(bookmarkNodes);
  filteredBookmarks = [...allBookmarks];
  
  // 添加加载更多按钮
  const loadMoreBtn = document.createElement('button');
  loadMoreBtn.id = 'loadMoreBtn';
  loadMoreBtn.className = 'load-more-btn';
  loadMoreBtn.textContent = '加载更多';
  loadMoreBtn.addEventListener('click', loadMoreBookmarks);
  bookmarkList.appendChild(loadMoreBtn);
  
  // 初始加载第一页
  loadBookmarksPage(1);
}

function loadBookmarksPage(page) {
  const bookmarksContainer = document.querySelector('.bookmarks-container');
  const startIndex = (page - 1) * PAGE_SIZE;
  const endIndex = startIndex + PAGE_SIZE;
  const bookmarksToShow = filteredBookmarks.slice(startIndex, endIndex);
  
  bookmarksToShow.forEach(bookmark => {
    const bookmarkItem = createBookmarkElement(bookmark.node, bookmark.category);
    bookmarksContainer.appendChild(bookmarkItem);
  });
  
  // 更新加载更多按钮的显示状态
  const loadMoreBtn = document.getElementById('loadMoreBtn');
  if (endIndex >= filteredBookmarks.length) {
    loadMoreBtn.style.display = 'none';
  } else {
    loadMoreBtn.style.display = 'block';
  }
}

function loadMoreBookmarks() {
  currentPage++;
  loadBookmarksPage(currentPage);
}

function updateCategorySelect() {
  const select = document.getElementById('categorySelect');
  const batchSelect = document.getElementById('batchCategorySelect');
  
  [select, batchSelect].forEach(selectElement => {
    selectElement.innerHTML = '';
    
    if (selectElement === batchSelect) {
      const defaultOption = document.createElement('option');
      defaultOption.value = '';
      defaultOption.textContent = '设置分类...';
      selectElement.appendChild(defaultOption);
    }
    
    chrome.storage.sync.get(['categories'], function(data) {
      const categories = data.categories || ['常用', '工作', '学习', '娱乐', '其他'];
      categories.forEach(category => {
        const option = document.createElement('option');
        option.value = category;
        option.textContent = category;
        selectElement.appendChild(option);
      });
    });
  });
}

function showCategoryManageModal() {
  const modal = document.getElementById('categoryManageModal');
  modal.style.display = 'block';
  updateCategoryManageList();
}

function closeCategoryManageModal() {
  const modal = document.getElementById('categoryManageModal');
  modal.style.display = 'none';
}

function updateCategoryManageList() {
  const container = document.querySelector('.category-manage-list');
  container.innerHTML = '';
  
  chrome.storage.sync.get(['categories'], function(data) {
    const categories = data.categories || ['常用', '工作', '学习', '娱乐', '其他'];
    
    categories.forEach(category => {
      const item = document.createElement('div');
      item.className = 'category-manage-item';
      
      const name = document.createElement('span');
      name.textContent = category;
      
      const actions = document.createElement('div');
      actions.className = 'actions';
      
      const editBtn = document.createElement('button');
      editBtn.className = 'edit-btn';
      editBtn.textContent = '编辑';
      editBtn.addEventListener('click', () => editCategory(category));
      
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'delete-btn';
      deleteBtn.textContent = '删除';
      deleteBtn.addEventListener('click', () => deleteCategory(category));
      
      actions.appendChild(editBtn);
      actions.appendChild(deleteBtn);
      
      item.appendChild(name);
      item.appendChild(actions);
      container.appendChild(item);
    });
  });
}

function editCategory(oldCategory) {
  const newCategory = prompt('请输入新的分类名称：', oldCategory);
  if (newCategory && newCategory !== oldCategory) {
    chrome.storage.sync.get(['categories', 'bookmarkCategories'], function(data) {
      const categories = data.categories || ['常用', '工作', '学习', '���乐', '其他'];
      const bookmarkCategories = data.bookmarkCategories || {};
      
      // 更新分类名称
      const index = categories.indexOf(oldCategory);
      if (index !== -1) {
        categories[index] = newCategory;
      }
      
      // 更新使用该分类的书签
      Object.keys(bookmarkCategories).forEach(bookmarkId => {
        if (bookmarkCategories[bookmarkId] === oldCategory) {
          bookmarkCategories[bookmarkId] = newCategory;
        }
      });
      
      // 保存更新
      chrome.storage.sync.set({ 
        categories, 
        bookmarkCategories 
      }, function() {
        updateCategoryManageList();
        loadBookmarks();
      });
    });
  }
}

function deleteCategory(category) {
  if (confirm(`确定要删除分类"${category}"吗？`)) {
    chrome.storage.sync.get(['categories', 'bookmarkCategories'], function(data) {
      const categories = data.categories || ['常用', '工作', '学习', '娱乐', '其他'];
      const bookmarkCategories = data.bookmarkCategories || {};
      
      // 删除分类
      const index = categories.indexOf(category);
      if (index !== -1) {
        categories.splice(index, 1);
      }
      
      // 移除使用该分类的书签的分类标记
      Object.keys(bookmarkCategories).forEach(bookmarkId => {
        if (bookmarkCategories[bookmarkId] === category) {
          delete bookmarkCategories[bookmarkId];
        }
      });
      
      // 保存更新
      chrome.storage.sync.set({ 
        categories, 
        bookmarkCategories 
      }, function() {
        updateCategoryManageList();
        loadBookmarks();
      });
    });
  }
}

function handleSearch() {
  const searchInput = document.getElementById('searchInput');
  const clearSearchBtn = document.getElementById('clearSearchBtn');
  const searchText = searchInput.value.toLowerCase();
  
  clearSearchBtn.style.display = searchText ? 'block' : 'none';
  
  // 筛选书签
  filteredBookmarks = allBookmarks.filter(bookmark => {
    const title = bookmark.node.title.toLowerCase();
    const url = bookmark.node.url.toLowerCase();
    const category = bookmark.category.toLowerCase();
    return title.includes(searchText) || url.includes(searchText) || category.includes(searchText);
  });
  
  // 重置分页并重新加载
  resetBookmarksList();
}

function clearSearch() {
  const searchInput = document.getElementById('searchInput');
  const clearSearchBtn = document.getElementById('clearSearchBtn');
  
  searchInput.value = '';
  clearSearchBtn.style.display = 'none';
  
  // 显示所有书签
  const bookmarkItems = document.querySelectorAll('.bookmark-item');
  bookmarkItems.forEach(item => item.classList.remove('hidden'));
  
  // 移除无结果提示
  removeNoResultsMessage();
}

function updateNoResultsMessage(hasResults) {
  removeNoResultsMessage();
  
  if (!hasResults) {
    const bookmarkList = document.querySelector('.bookmark-list');
    const message = document.createElement('div');
    message.className = 'no-results';
    message.textContent = '没有找到匹配的书签';
    bookmarkList.appendChild(message);
  }
}

function removeNoResultsMessage() {
  const message = document.querySelector('.no-results');
  if (message) {
    message.remove();
  }
}

function resetBookmarksList() {
  currentPage = 1;
  const bookmarksContainer = document.querySelector('.bookmarks-container');
  bookmarksContainer.innerHTML = '';
  
  if (filteredBookmarks.length === 0) {
    updateNoResultsMessage(false);
  } else {
    removeNoResultsMessage();
    loadBookmarksPage(1);
  }
}

function toggleBatchMode() {
  batchMode = !batchMode;
  const batchModeBtn = document.getElementById('batchModeBtn');
  const batchToolbar = document.getElementById('batchToolbar');
  const bookmarkItems = document.querySelectorAll('.bookmark-item');
  
  batchModeBtn.classList.toggle('active');
  batchToolbar.classList.toggle('visible');
  
  bookmarkItems.forEach(item => {
    item.classList.toggle('selectable');
  });
  
  if (!batchMode) {
    // 退出批量模式时清除选择
    selectedBookmarks.clear();
    updateSelectedCount();
    bookmarkItems.forEach(item => item.classList.remove('selected'));
  }
}

function cancelBatchMode() {
  if (batchMode) {
    toggleBatchMode();
  }
}

function updateSelectedCount() {
  const countElement = document.getElementById('selectedCount');
  countElement.textContent = selectedBookmarks.size;
  
  // 更新删除按钮状态
  const deleteBtn = document.getElementById('batchDeleteBtn');
  deleteBtn.disabled = selectedBookmarks.size === 0;
}

function setBatchCategory(e) {
  const category = e.target.value;
  if (!category || selectedBookmarks.size === 0) return;
  
  chrome.storage.sync.get(['bookmarkCategories'], function(data) {
    const bookmarkCategories = data.bookmarkCategories || {};
    
    selectedBookmarks.forEach(bookmarkId => {
      bookmarkCategories[bookmarkId] = category;
    });
    
    chrome.storage.sync.set({ bookmarkCategories }, function() {
      loadBookmarks();
      cancelBatchMode();
    });
  });
}

function deleteBatchBookmarks() {
  if (selectedBookmarks.size === 0) return;
  
  if (confirm(`确定要删除选中的 ${selectedBookmarks.size} 个书签吗？`)) {
    const deletePromises = Array.from(selectedBookmarks).map(bookmarkId => {
      return new Promise((resolve) => {
        chrome.bookmarks.remove(bookmarkId, resolve);
      });
    });
    
    Promise.all(deletePromises).then(() => {
      chrome.storage.sync.get(['bookmarkCategories'], function(data) {
        const bookmarkCategories = data.bookmarkCategories || {};
        
        selectedBookmarks.forEach(bookmarkId => {
          delete bookmarkCategories[bookmarkId];
        });
        
        chrome.storage.sync.set({ bookmarkCategories }, function() {
          loadBookmarks();
          cancelBatchMode();
        });
      });
    });
  }
}

// 主题相关
function setupTheme() {
  const themeToggleBtn = document.getElementById('themeToggleBtn');
  const themeIcon = themeToggleBtn.querySelector('.theme-icon');
  const themeSelect = document.getElementById('themeSelect');
  
  // 加载保存的主题设置
  chrome.storage.sync.get(['theme'], function(data) {
    const savedTheme = data.theme || 'system';
    themeSelect.value = savedTheme;
    applyTheme(savedTheme);
    updateThemeIcon(savedTheme === 'dark' ? 'dark' : 'light');
  });
  
  // 主题切换按钮点击事件
  themeToggleBtn.addEventListener('click', () => {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    applyTheme(newTheme);
    themeSelect.value = newTheme;
    saveThemeSetting(newTheme);
    updateThemeIcon(newTheme);
  });
  
  // 主题选择改变事件
  themeSelect.addEventListener('change', (e) => {
    const theme = e.target.value;
    applyTheme(theme);
    saveThemeSetting(theme);
    updateThemeIcon(theme === 'system' 
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : theme
    );
  });
}

function updateThemeIcon(theme) {
  const themeIcon = document.querySelector('.theme-icon');
  themeIcon.textContent = theme === 'dark' ? '🌙' : '☀️';
}

function applyTheme(theme) {
  if (theme === 'system') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    updateThemeIcon(prefersDark ? 'dark' : 'light');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
    updateThemeIcon(theme);
  }
}

function saveThemeSetting(theme) {
  chrome.storage.sync.set({ theme });
}

// 设置面板
function setupSettings() {
  const settingsBtn = document.getElementById('settingsBtn');
  const settingsPanel = document.getElementById('settingsPanel');
  const closeSettingsBtn = document.getElementById('closeSettingsBtn');
  const pageSizeSelect = document.getElementById('pageSizeSelect');
  
  // 加载保存的设置
  chrome.storage.sync.get(['pageSize'], function(data) {
    const savedPageSize = data.pageSize || 20;
    pageSizeSelect.value = savedPageSize;
    PAGE_SIZE = savedPageSize;
  });
  
  settingsBtn.addEventListener('click', () => {
    settingsPanel.classList.add('visible');
  });
  
  closeSettingsBtn.addEventListener('click', () => {
    settingsPanel.classList.remove('visible');
  });
  
  pageSizeSelect.addEventListener('change', (e) => {
    const newPageSize = parseInt(e.target.value);
    PAGE_SIZE = newPageSize;
    chrome.storage.sync.set({ pageSize: newPageSize }, function() {
      resetBookmarksList();
    });
  });
  
  const exportDataBtn = document.getElementById('exportDataBtn');
  const importDataBtn = document.getElementById('importDataBtn');
  const importFile = document.getElementById('importFile');
  
  exportDataBtn.addEventListener('click', exportData);
  importDataBtn.addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', importData);
}

// 导出数据
async function exportData() {
  try {
    const data = await getExportData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bookmark-categories-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showNotification('数据导出成功！');
  } catch (error) {
    showNotification('导出失败：' + error.message, 'error');
  }
}

// 获取导出数据
function getExportData() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['categories', 'bookmarkCategories', 'theme', 'pageSize'], function(data) {
      resolve({
        version: '1.0',
        exportDate: new Date().toISOString(),
        data: {
          categories: data.categories || [],
          bookmarkCategories: data.bookmarkCategories || {},
          settings: {
            theme: data.theme || 'system',
            pageSize: data.pageSize || 20
          }
        }
      });
    });
  });
}

// 导入数据
async function importData(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  try {
    const content = await readFileContent(file);
    const data = JSON.parse(content);
    
    // 验证数据格式
    if (!validateImportData(data)) {
      throw new Error('无效的数据格式');
    }
    
    // 保存导入的数据
    await saveImportedData(data.data);
    
    showNotification('数据导入成功！');
    loadBookmarks(); // 重新加载书签
    event.target.value = ''; // 清除文件选择
  } catch (error) {
    showNotification('导入失败：' + error.message, 'error');
  }
}

// 读取文件内容
function readFileContent(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = (e) => reject(new Error('文件读取失败'));
    reader.readAsText(file);
  });
}

// 验证导入数据
function validateImportData(data) {
  return data 
    && data.version 
    && data.data 
    && Array.isArray(data.data.categories)
    && typeof data.data.bookmarkCategories === 'object';
}

// 保存导入的数据
function saveImportedData(data) {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.set({
      categories: data.categories,
      bookmarkCategories: data.bookmarkCategories,
      theme: data.settings?.theme || 'system',
      pageSize: data.settings?.pageSize || 20
    }, function() {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
}

// 显示通知
function showNotification(message, type = 'success') {
  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  notification.textContent = message;
  document.body.appendChild(notification);
  
  // 添加动画类
  setTimeout(() => notification.classList.add('show'), 10);
  
  // 3秒后移除通知
  setTimeout(() => {
    notification.classList.remove('show');
    setTimeout(() => notification.remove(), 300);
  }, 3000);
} 